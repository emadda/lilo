import _ from "lodash";
import {afterEach, expect, test} from "bun:test";
import {Database} from "bun:sqlite";

import {sleep} from "./../../src/lib/util";
import {config, get_log_name} from "../util/config";
import {states} from "../../src/lib/gcp/util";

const to_kill = [];

const run_cmd = (ar) => {

    const proc = Bun.spawn(ar, {
        cwd: process.cwd(),
        onExit(proc, exitCode, signalCode, error) {
            // console.log(`onExit called`, {ar, cli: ar.join(" "), exitCode, signalCode, error});
        },
        stdout: "pipe",
        stderr: "pipe"
    });

    // await p.exited;
    to_kill.push(proc);
    return proc;
}


// Use files for stdout and stderr.
// - Long processes can be observed.
// - String match against file contents.
const run_cmd_with_file_out = (ar, file_prefix) => {

    const stdout = Bun.file(`${file_prefix}.stdout.txt`);
    const stderr = Bun.file(`${file_prefix}.stderr.txt`);

    const proc = Bun.spawn(ar, {
        cwd: process.cwd(),
        onExit(proc, exitCode, signalCode, error) {
            // console.log(`onExit called`, {ar, cli: ar.join(" "), exitCode, signalCode, error});
        },
        stdout,
        stderr
    });

    to_kill.push(proc);

    return {
        proc,
        get_cur_stdout: async () => stdout.text(),
        get_cur_stderr: async () => stderr.text(),

        // Returns true if found within the time limit.
        // False when time expires.
        wait_for_stdout_to_contain: async (re_match, count, wait_for_max_ms) => {
            const s = performance.now();
            while ((performance.now() - s) <= wait_for_max_ms) {
                const str = await stdout.text();

                const matches = [...(str.matchAll(re_match))].length;
                if (matches >= count) {
                    return true;
                }
                await sleep(100);
            }

            // Out of time.
            return false;
        }

        // get_cur_stdout_json_lines
    }
}


const readable_stream_to_text = async (rs) => {
    if (rs instanceof ReadableStream) {
        // Read all at once for errors.
        // - `tee`: Avoid `TypeError: object is undefined` from Bun when stderr is an empty stream.
        const [a, b] = rs.tee();
        return await new Response(a).text();
    }
    return null;
}

const random_id = () => Math.random().toString(36).slice(2);

const run_many_log_entry_processes = (c) => {
    const x = random_id();
    const log_id = `log_id_${x}`;

    const procs = [];

    // This results in a negative diff.
    // const start_hr_time = process.hrtime();

    const start_at_iso_date = new Date(Date.now() + 1000);

    for (let i = 0; i < c.total_processes; i++) {

        procs.push({
            // proc: run_one(log_id, 1_000)
            proc: run_one(log_id, c, start_at_iso_date),
            log_entry_ids: [],
            start_at_iso_date
        });
    }

    return {
        log_id,
        procs
    }
}


const run_one = (log_id, c, start_at_iso_date) => {
    const proc = run_cmd([
        "./util/write-many.ts",
        JSON.stringify({
            log_id,
            total_http_requests: c.total_http_requests,
            log_entries_per_request: c.log_entries_per_request,
            start_at_iso_date
        }),
    ]);
    return proc;
}


const get_std_x = async (proc) => {
    return {
        stdout: await readable_stream_to_text(proc.stdout),
        stderr: await readable_stream_to_text(proc.stderr)
    }
}


const stop_all_and_collect_ids = async (procs) => {
    for (const x of procs) {
        x.proc.kill();
        await sleep(10);
        const stdout = await readable_stream_to_text(x.proc.stdout);
        const stderr = await readable_stream_to_text(x.proc.stderr);
        // console.log({stdout, stderr});

        const log_entry_ids = stdout.split("\n");
        x.log_entry_ids = log_entry_ids;
    }
}


const run = async (c) => {
    const {
        lilo_cli_instances = "one",

        // Start this many processes, each writing log entries as fast as possible with concurrent requests.
        total_processes = 2,

        // For each process, start this many concurrent log entry HTTP POST requests all at the same time, and let the event loop queue them.
        // - A very high number will just queue up the requests and action them as fast as possible.
        total_http_requests = 2,

        // For each HTTP POST request select a random number of entries between these two numbers.
        log_entries_per_request = [1, 1],


        wait_for_ids_to_exist = 60_000,
        wait_for_write_processes = 60_000
    } = c;


    const state_to_test = null;
    // const state_to_test = states.WAITING_FOR_FUTURE_EVENT;
    // const state_to_test = states.WAITING_FOR_SERVER_TO_COMPUTE;


    console.log({step: "STARTING_LOG_WRITE_PROCESSES"});
    const {log_id, procs} = run_many_log_entry_processes(c);

    const target_dir = `./01/del/${log_id}`;
    await run_cmd(["rm", "-rf", `./01/del`]).exited;
    await run_cmd(["mkdir", "-p", target_dir]).exited;
    console.log({log_id, target_dir});


    console.log({step: "STARTING_LILOS"});
    const log_name = get_log_name(log_id);
    const lilos = {};
    const add_lilo = (name, watch = undefined) => {


        const today = new Date().toISOString().replace(/T.+$/, "T00:00:00Z");

        // Note: WAITING_FOR_FUTURE_EVENT seems to happen even with an older date. GCP index issue?
        let timestamp_gt = `AND timestamp > "${today}"`;

        if (state_to_test === states.WAITING_FOR_FUTURE_EVENT) {
            timestamp_gt = `AND timestamp > "${new Date().toISOString()}"`;
        }

        if (state_to_test === states.WAITING_FOR_SERVER_TO_COMPUTE) {
            // Not adding the timestamp makes the read query much slower (up to 1 minute).
            // This is useful to test the state of waiting for the server to compute a query result.
            timestamp_gt = ``;
        }


        const db_file = `${target_dir}/${name}.sqlite`;
        const args = [
            "bun",
            "./../src/cli.ts",
            `--resource-names=projects/${config.project_id}`,
            `--db=${db_file}`,
            `--filter`,
            `logName=${log_name} ${timestamp_gt}`
        ];

        if (_.isNumber(watch)) {
            args.push(`--watch=${watch}`)
        }

        if (_.isBoolean(watch)) {
            if (watch) {
                args.push(`--watch`);
            }
        }

        // @todo/low Add different page sizes to test pagination logic.
        lilos[name] = {
            cmd: run_cmd_with_file_out(args, `${target_dir}/${name}`),
            db_file,

            // Insert ids and left join to make analysing errors easier.
            insert_ids_written_to_gcp: (ids) => {
                const db = new Database(db_file);
                db.query(`create table test_ids_written_to_gcp(row_id INTEGER PRIMARY KEY AUTOINCREMENT, log_id TEXT)`).run();
                const ins = db.prepare(`INSERT INTO test_ids_written_to_gcp(log_id) VALUES (:log_id)`);

                db.transaction(() => {
                    for (const log_id of ids) {
                        ins.run({":log_id": log_id});
                    }
                })();

                // Merge WAL files after writes.
                db.query(`PRAGMA wal_checkpoint(TRUNCATE)`).run();
            },

            // Get all ids that were known to be written to GCP logs, but the lilo CLI did not download them for some reason.
            get_all_missing_ids: () => {
                const db = new Database(db_file);
                const missing = db.query(`
                    SELECT
                    *
                    FROM
                    test_ids_written_to_gcp a
                    WHERE
                    a.log_id NOT IN (
                        SELECT
                    jsonPayload ->> "$.id" AS log_id FROM logs)
                `).all();

                return missing;
            },

            // Writes ordered ID lists to diff in a GUI program to make it easier to visualize the timeline and any gaps.
            write_id_lists_to_files_for_diff_gui: async () => {
                const db = new Database(db_file);
                const inserted_via_lilo_cli = db.query(`select jsonPayload ->> "$.id" id from logs order by id asc`).all();
                const inserted_via_test = db.query(`select log_id id from test_ids_written_to_gcp order by id asc`).all();
                await Bun.write(`${target_dir}/${name}_inserted_via_lilo_cli.txt`, inserted_via_lilo_cli.map(x => x.id).join("\n"));
                await Bun.write(`${target_dir}/${name}_inserted_via_test.txt`, inserted_via_test.map(x => x.id).join("\n"));
            }

        };
    }


    if (lilo_cli_instances === "one") {
        add_lilo("watch-default", true);
    } else {
        // Note: GCP logging has a 60 raed reqs/min quota - these will 429 and throttle themselves.
        // - You can request a quota increase from GCP.

        add_lilo("watch-default", true);
        // add_lilo("watch-0", 0);
        // add_lilo("watch-5", 5);
        //
        // add_lilo("watch-50", 50);
        // add_lilo("watch-500", 500);
        add_lilo("watch-5000", 5000);
        add_lilo("watch-10000", 10000);

    }


    // @todo/next add a kill/reboot cycle to test downloading from the last entry.
    // - Note: Will not work as it can take 40s for the GCP server to respond with log entries.


    console.log({step: "WAITING_FOR_GCP_LOG_WRITES_TO_COMPLETE", wait_for_write_processes});
    // Generate ID's continuously for this long.

    // Wait for either all log writes to complete or until the timeout.
    // - If the timeout is reached the test asserts 100% of log entries up until that point are in the db file.
    await Promise.race([
        sleep(wait_for_write_processes),
        Promise.all(procs.map(x => x.proc.exited))
    ]);


    console.log({step: "COLLECTING_LOG_IDS"});
    // Stop log writing processes and read the written log ID's.
    await stop_all_and_collect_ids(procs);
    const ids_should_exist = procs.map(x => x.log_entry_ids).flat().filter(x => x.length > 0);
    if (ids_should_exist.length < 20) {
        console.log({ids_should_exist});
    }
    expect(ids_should_exist.length).toBeGreaterThan(2);

    const all = _.toPairs(lilos);

    // Check all ID's exist.
    for (const [name, x] of all) {
        x.insert_ids_written_to_gcp(ids_should_exist);
    }


    console.log({step: "WAITING_FOR_IDS_TO_ALL_EXIST_IN_DB_FILE", wait_for_ids_to_exist});
    const s = performance.now();
    while (true) {
        const complete = all.map(([name, x]) => x.get_all_missing_ids()).filter(x => x.length === 0);
        if (complete.length === all.length) {
            break;
        }

        if ((performance.now() - s) > wait_for_ids_to_exist) {
            break;
        }

        await sleep(3_000);
    }


    for (const [name, x] of all) {
        await x.write_id_lists_to_files_for_diff_gui();
    }


    // Check all ID's exist.
    for (const [name, x] of all) {
        const missing = x.get_all_missing_ids();
        if (missing.length > 0) {
            console.error({name, missing_length: missing.length});
        }
        expect(missing.length).toBe(0);
    }


    // Note: afterEach will kill running processes.
};


// Implicitly tests:
// - Watch mode CLI args
//      - Different timing's.
//      - Handles HTTP 429 (GCP account defaults to a quota of 60 HTTP read requests per min).
// - GCP HTTP API pagination logic
//      - Especially tailing/polling the last page which seems to toggle the set of logs it returns and is not deterministic.


// Single CLI with low GCP write concurrency to make development faster and ensure everything is connected ok.
test("ONE_LILO_CLI: 100% complete set of logs are read whilst concurrently being written.", async () => {
    await run({
        lilo_cli_instances: "one",
        total_processes: 2,
        total_http_requests: 2,
        log_entries_per_request: [1, 1],
        wait_for_ids_to_exist: 60_000
    });
}, 60 * 1000);

// Many lilo CLI instances with highest GCP write concurrency. Stress test.
test.skip("MANY_LILO_CLI: 100% complete set of logs are read whilst concurrently being written.", async () => {
    await run({
        lilo_cli_instances: "many",
        total_processes: 10,
        total_http_requests: 500,
        log_entries_per_request: [1, 2],
        wait_for_ids_to_exist: 60_000,
        wait_for_write_processes: 60_000 * 3
    });
}, 60 * 1000 * 12);


// Kill any started processes after each test.
afterEach(() => {
    for (const x of to_kill) {
        x.kill();
    }
    _.remove(to_kill, () => true);

});