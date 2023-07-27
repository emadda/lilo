#!/usr/bin/env bun
import _ from "lodash";
import {write} from "./../../src/lib/gcp/logs-write";
import {config, get_log_name} from "./config";

// This script writes many log entries to GCP logs concurrently.
// - Each log entry has a unique ID.
// - Unique IDs are output to stdout.
// - These IDs can be used to check against download processes to ensure they have downloaded all the IDs that were written.
// - This is a separate script to avoid blocking the event loop.
// - Testing requires concurrency as tailing the newest logs often results in ordering inconsistencies.
//      - The GCP server response for reading the end logs page (without a nextPageToken) is inconsistent.


const config_self = {
    total_http_requests: 1,
    log_entries_per_request: [1, 100],
    project_id: config.project_id,
    log_id: "log-name-write-many-replace-this",
    start_at_iso_date: new Date(),
    ...JSON.parse(_.last(Bun.argv))
};

const alpha = "abcdefghijklmnopqrstuvwxyz".split("");
const get_new_writer_id = () => {
    const x = [];
    for (let i = 0; i < 7; i++) {
        x.push(_.sample(alpha));
    }
    return _.shuffle(x).join("");
}


let writer_id = get_new_writer_id();
let cur_id = 0;

// When joining ID's from all concurrent writers and ordering, the order should be consistent with their write order.
// - Note: Ordering is only consistent per writer process, ordering between processes is only rough (but better than random numbers).
const get_unique_id = () => {
    const [seconds, nanos] = process.hrtime(start_hr_time);

    cur_id += 1;
    // return new Date().toISOString() + `_s${seconds}_n${nanos}_id${cur_id.toString().padStart(6, "0")}_wid${writer_id}`
    return `s${seconds.toString().padStart(4, "0")}_n${nanos.toString().padStart(9, "0")}_id${cur_id.toString().padStart(6, "0")}_${writer_id}`
};

const get_entries = (total = _.random(...config_self.log_entries_per_request)) => {
    const x = [];

    for (let i = 0; i < total; i++) {
        x.push({
            // "insertId": "1snsk78fx0iqrn",
            "jsonPayload": {
                "id": get_unique_id()
            },
            // @see https://cloud.google.com/monitoring/api/resources#tag_global
            "resource": {
                "type": "global",
                // "type": "project",
                "labels": {project_id: config_self.project_id}
            },
            // "timestamp": "2023-07-19T22:22:12.602169317Z",
            // "logName": "x",
            // "receiveTimestamp": "2023-07-19T22:22:12.602169317Z"
        });
    }


    return x;
}


// This takes around 30ms each run:
// gcloud logging write my-test-log '{ "message": "My second entry", "weather": "partly cloudy"}' --payload-type=json --project=x
// HTTP calls are around one every 5ms.

// **Roughly** sync multiple writers to the same clock so that their ID's can be ordered.
// @todo/low Use a better sync primitive with nanosecond resolution.
await Bun.sleep(new Date(config_self.start_at_iso_date));

// @see https://bun.sh/docs/api/utils#bun-nanoseconds
let start_hr_time = process.hrtime();


let i = 0;
while (i < config_self.total_http_requests) {
    (async () => {
        // console.log(new Date());
        const entries = get_entries();
        const s = performance.now();
        const ok = await write({logName: get_log_name(config_self.log_id)}, entries);
        const ms = performance.now() - s;
        // console.log({ms, ok});

        if (ok) {
            for (const x of entries) {
                console.log(x.jsonPayload.id);
            }
        }

    })();
    i++;
}


