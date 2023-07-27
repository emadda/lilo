import _ from "lodash";
import {z} from "zod";
import minimist from "minimist";

import {sleep} from "./lib/util";
import {get_ins, params, to_params_obj} from "./lib-app/db-ins";
import {get_cols} from "./lib-app/config";
import {get_all} from "./lib/gcp/logs-read";

import help from "./lib-app/help.txt";
import p from "./../package.json";

const get_args_from_cli = () => {
    // Default args for download cmd.
    const d = {
        cmd: "download",
        resource_names: null,
        filter: null,
        db: null,
        watch: null,

        // Note: `minimist` translates `--no-x` to a `x = true|false`.
        // query_from_last_receive_timestamp_stored: true,

        // @todo/low
        output_json_lines: false,

    };

    const cli_args = minimist(Bun.argv);
    // console.log(cli_args);


    const [bun, file, cmd = "download"] = cli_args._;
    const cp = {...cli_args};
    delete cp._;

    // Rename keys: a-b to a_b
    const cp2 = {};
    for (const [k, v] of _.toPairs(cp)) {
        cp2[k.replaceAll("-", "_")] = v;
    }


    const x = {
        ...d,
        cmd,
        ...cp2
    };

    console.log("CLI args.", x);

    return x;
};

const resource_name_s = z.string().min(1);
const resource_name_ar = z.array(resource_name_s);


const cmd_download_s = z.object({
    cmd: z.literal("download"),
    resource_names: z.string().min(1).transform((v, c) => {
        const val = v.trim();
        if (val.startsWith("[")) {
            try {
                const x = JSON.parse(val);
                const ok = resource_name_ar.safeParse(x);
                if (!ok.success) {
                    c.addIssue(ok.error);
                    return z.NEVER;
                }
                return x;
            } catch (e) {
                c.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "resourceNames starts with a [ but it is not a valid JSON value",
                });
                return z.NEVER;
            }
        }
        return [v];
    }),
    filter: z.string().nullable(),
    db: z.string(),
    watch: z.union([z.null(), z.number().int().gte(0), z.boolean()]).transform((val) => {
        // Note: `minimist` turns `--watch` into true, `--no-watch` into false.
        if (val === false || val === null) {
            return null;
        }
        if (val === true) {
            // Default 2000ms.
            return 2000;
        }
        return val;
    }),
    output_json_lines: z.boolean(),
    // query_from_last_receive_timestamp_stored: z.boolean()
});


const validate_config = (x) => {
    if (x.cmd === "help") {
        return {
            ok: true,
            config: x
        };
    }

    if (x.cmd === "version") {
        return {
            ok: true,
            config: x
        };
    }

    if (x.cmd === "download") {
        const ok = cmd_download_s.safeParse(x);
        if (!ok.success) {
            console.error("CLI args invalid.");
            console.error(ok.error.message);
            return {
                ok: false,
                config: null
            };
        }

        return {
            ok: true,
            config: ok.data
        };
    }


    console.error("Unknown cmd", x.cmd);
    return {
        ok: false,
        config: null
    };
}

const get_version = () => p.version;

// Do not allow the config to change as it represents the log query.
// - Changing the log query could lead to incomplete SQL query result sets.
const assert_config_has_not_changed = (db_ins, config) => {
    const first_run = db_ins.t.runs.get_first_run();
    if (first_run !== null) {
        const first_config = JSON.parse(first_run.config);

        const get_affects_result_set = (x) => {
            const {resource_names, filter} = x;
            return {resource_names, filter};
        }

        const old = get_affects_result_set(first_config);
        const cur = get_affects_result_set(config);

        if (!_.isEqual(old, cur)) {
            console.error(`Config changed when running against an existing SQLite DB. Please use the same config.`, {
                old,
                cur
            });
            return false;
        }
    }
    return true;
};

// Re-read entries from the last receiveTimestamp minus this time.
// Google Logs is not strongly consistent, it takes an unspecified amount of time before written logs are readable.
// Re-read and de-dupe entries to avoid missing any.
const start_overlap_in_ms = 1000 * 60 * 1;

// Do not read up until the leading edge of time. The returned logs are unpredictable/shuffled.
// Also for fast log write rates the end page may never be reached.
const up_to_before_now_ms = 2000;

const add_from_to_ts = (db_ins, existing_filter) => {
    let read_from = null;

    const read_to = new Date(Date.now() - up_to_before_now_ms);
    const read_to_iso = read_to.toISOString();
    let filter = `receiveTimestamp <= "${read_to_iso}"`;


    // Read logs from greater-or-matching the existing highest timestamp stored.
    // - Issue: log lines can be inserted with a past date.
    // - Assumption: receiveTimestamp cannot be user set.
    // - Assumption: Log entries cannot be inserted before a receiveTimestamp that was read from a given log line.
    const all_with_last_ts = db_ins.t.logs.get_rows_with_last_receive_timestamp();
    if (all_with_last_ts.length > 0) {
        const last_receive_ts = all_with_last_ts[0].receiveTimestamp;

        read_from = new Date((new Date(last_receive_ts)).getTime() - start_overlap_in_ms);
        const read_from_iso = read_from.toISOString();

        filter = `receiveTimestamp >= "${read_from_iso}" AND ${filter}`;
    }

    const existing_filter_ok = (_.isString(existing_filter) && existing_filter.trim().length > 0);
    if (existing_filter_ok) {
        filter = `${existing_filter} AND ${filter}`;
    }

    console.log("Reading logs between `receiveTimestamp`.", {read_from, read_to});
    return filter;
}

const run = async () => {
    const args = get_args_from_cli();
    const {ok, config} = validate_config(args);

    if (!ok) {
        console.log(help);
        return;
    }


    if (config.cmd === "help") {
        console.log(help);
        return;
    }


    if (config.cmd === "version") {
        console.log(`lilo ${get_version()}`);
        return;
    }

    if (config.cmd !== "download") {
        return;
    }


    // @todo/low config.output_json_lines

    const db_ins = get_ins({db_file: config.db});
    if (!assert_config_has_not_changed(db_ins, config)) {
        return;
    }


    const run_id = db_ins.t.runs.insert(params({
        version: get_version(),
        config: JSON.stringify(config)
    }));


    while (true) {
        const filter_with_from_to_ts = add_from_to_ts(db_ins, config.filter);

        const a_iter = get_all({
            watch: config.watch,
            req_opts: {
                resourceNames: config.resource_names,
                filter: filter_with_from_to_ts
            }
        });
        for await (const entries of a_iter) {
            const s = performance.now();

            // console.log("Inserting log.insertId's", entries.map(x => x.insertId));

            // Time: around 15ms on Mac M1 for 1k small rows.
            db_ins.db.transaction(() => {
                for (const e of entries) {
                    const row_data = {
                        ...{
                            insertId: null,
                            run_id,
                            logName: null,
                            severity: null,
                            textPayload: null,
                            jsonPayload: null,
                            protoPayload: null,
                            receiveTimestamp: null,
                            timestamp: null,
                            resource: null,
                            labels: null,
                            trace: null
                        },
                        ...e,
                    };

                    const row = to_params_obj(row_data, get_cols());
                    // console.log("Inserting", row);
                    try {
                        db_ins.t.logs.insert.run(row);
                    } catch (err) {
                        console.log(e);
                        throw err;
                    }

                }
            })();
            const ms = Math.ceil(performance.now() - s);
            console.info(`Inserted log entries.`, {total: entries.length, ms});
        }


        if (_.isNumber(config.watch)) {
            await sleep(config.watch);
            continue;
        }

        break;
    }


    // beforeExit does not seem to reliably run on crash.
    db_ins.t.runs.update_end_now(params({run_id}));
}

console.log("Started");

await run();
// await list_log_entries();


console.log("Completed");

