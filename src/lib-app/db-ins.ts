import _ from "lodash";
import * as fs from "fs";
import {Database} from "bun:sqlite";
import {config, get_cols} from "./config";
import {is_dev} from "../lib/util";




const now = `datetime('now')`;

const get_db = (db_file) => {
    if (is_dev() && false) {
        try {
            fs.unlinkSync(db_file);
            console.warn("Deleted old db_file in dev.", {db_file});

            fs.unlinkSync(db_file + "-shm");
            fs.unlinkSync(db_file + "-wal");
        } catch (e) {

        }


    }


    const db = new Database(db_file, {create: true});

    db.query(`PRAGMA journal_mode = WAL`).run();
    db.query(`PRAGMA busy_timeout = 30000`).run();

    return db;
}

const create_schema = (db) => {

    db.query(`create table if not exists logs (${config.log_cols_sql_types})`).run();

    // Allow getting the max quickly on startup.
    // - Also optimize user queries for ranges.
    db.query(`create index if not exists i_logs_timestamp ON logs(timestamp)`).run();
    db.query(`create index if not exists i_logs_receive_timestamp ON logs(receiveTimestamp)`).run();

    db.query(`create table if not exists runs (run_id INTEGER PRIMARY KEY, version TEXT, config TEXT, start_ts TEXT, end_ts TEXT)`).run();

    // if (is_dev()) {
    //     console.warn("Deleting logs from prev run in development.");
    //     db.query("delete from logs").run();
    // }
}


const get_ins = (opts) => {
    const {db_file} = opts;

    const db = get_db(db_file);
    create_schema(db);

    const stmt = db.prepare("SELECT last_insert_rowid() as id");
    const get_last_insert_id = () => {
        return stmt.get().id;
    }

    const logs_fns = () => {
        const cols_have_data = get_cols().filter(x => !["log_id"].includes(x));

        // `OR IGNORE` is used as GCP can return the same log entry multiple times separated by many other pages of logs.
        const insert = db.prepare(`INSERT OR IGNORE INTO logs(${cols_have_data.join(", ")}) VALUES (${cols_have_data.map(x => `:${x}`).join(", ")})`);

        // Get all logs with the last timestamp (many logs can have the same timestamp - very common with receiveTimestamp even with ns accuracy).
        // - E.g. inserting log lines manually with a static timestamp, or highly concurrent systems.
        // - `receiveTimestamp` used as this is set by the logging system, `timestamp` can be user set to a date in the past.
        // @see https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry
        const get_rows_with_last_receive_timestamp = () => {
            return db.query("select * from logs where receiveTimestamp = (select max(receiveTimestamp) from logs)").all();
        };

        return {
            insert,
            get_rows_with_last_receive_timestamp
        }
    }

    const runs_fns = () => {
        const insert_stmt = db.prepare(`INSERT INTO runs(version, config, start_ts) VALUES (:version, :config, ${now})`);
        const update_end_now = db.prepare(`UPDATE runs SET end_ts = ${now} WHERE run_id = :run_id`);

        const insert = (params) => {
            insert_stmt.run(params);
            return get_last_insert_id();
        };

        const get_first_run = () => db.query("select * from runs order by run_id asc limit 1").get()

        return {
            insert,
            update_end_now: (...args) => update_end_now.run(...args),
            get_first_run
        }
    };


    return {
        db,

        // Tables
        t: {
            logs: logs_fns(),
            runs: runs_fns()
        }
    };

};

// Extracts keys from object and prepends them with `:` for use as a SQLite parameter in a prepared statement.
// E.g: `{a: 1}` => `{":a": 1}`
// - Will also JSON stringify objects for SQL inserts.
const to_params_obj = (obj, keys) => {
    const o = {};
    for (const k of keys) {
        if (k in obj) {
            const v = obj[k];
            o[`:${k}`] = _.isObject(v) ? JSON.stringify(v) : v;
        }
    }
    return o;
}

// Renames all keys for use with SQLite params
const params = (x) => {
    const o = {};
    for (const [k, v] of _.toPairs(x)) {
        o[`:${k}`] = v;
    }
    return o;
};


export {
    get_ins,
    to_params_obj,
    params
}