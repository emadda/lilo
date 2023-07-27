import {config} from "../../lib-app/config";
import _ from "lodash";
import {is_dev, sleep} from "../util";
import {get_auth_token_cached, get_new_token, states} from "./util";


const wait_ms = 2000;

const assert_true = (x) => {
    if (!x) {
        throw Error("Assertion failed.");
    }
}


// User `performance` API to avoid clock skew.
const get_started_at = () => {
    return new Date(performance.timeOrigin + performance.now()).toISOString();
}

// @todo/med When a "from" date is given, use concurrent requests to speed up the download (one process per day perhaps).
async function* get_all(opts) {
    const {
        req_opts = {},
        retry = true
    } = opts;

    let at = get_auth_token_cached();

    // Use reverse proxy in dev to observe requests.
    const url = is_dev() ? `https://localhost:64016/v2/entries:list` : `https://logging.googleapis.com/v2/entries:list`;

    if (is_dev()) {
        console.log("API URL.", {url});
    }


    const default_req_opts = {
        // Docs: Optional. Deprecated. Use resourceNames instead.
        "projectIds": [],
        "resourceNames": [],

        // @see https://cloud.google.com/logging/docs/view/logging-query-language
        "filter": undefined,

        // asc is default.
        "orderBy": `timestamp asc`,
        "pageSize": 1000,
    };
    const final_req_opts = {
        ...default_req_opts,
        ...req_opts
    }

    console.log("Initial request params", final_req_opts);

    let pageToken = undefined;
    const page_type_history = [];
    const page_history_count_last_x = (k) => _.takeWhile(page_type_history.reverse(), (x) => x === k).length;

    // Read until the last page.
    while (true) {
        let req = null;
        try {
            const body = {
                ...final_req_opts,
                pageToken
            };

            req = await fetch(url, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${at}`
                },

                // @see https://cloud.google.com/logging/docs/reference/v2/rest/v2/entries/list
                body: JSON.stringify(body)
            });
        } catch (e) {
            console.error("Network error. HTTP request to GCP logging failed.", e);
            if (retry) {
                console.error("Will retry in 2s");
                await sleep(wait_ms);
                continue;
            } else {
                break;
            }
        }

        const res = await req.json();

        if (!req.ok) {
            console.error("GCP responded with non-200. Will retry.", res);
            if (req.status === 429) {
                console.error("HTTP 429 note: Default read requests per minute quota is 60, you can increase it here: https://console.cloud.google.com/apis/api/logging.googleapis.com/quotas");
            }
            if (req.status === 401) {
                console.log("Getting new auth token.");
                at = get_new_token();
            }

            await sleep(10_000);
            continue;
        }

        const state_map = {
            [states.WAITING_FOR_FUTURE_EVENT]: _.keys(res).length === 0,
            [states.WAITING_FOR_SERVER_TO_COMPUTE]: !("entries" in res) && ("nextPageToken" in res),
            [states.FINAL_PAGE]: ("entries" in res) && res.entries.length > 0 && ("nextPageToken" in res),
            [states.IN_PROGRESS_PAGE]: ("entries" in res) && !("nextPageToken" in res)
        }
        const state = _.toPairs(state_map).find(([k, v]) => v)[0];
        page_type_history.push(state);
        console.log("HTTP 200 returned from GCP.", {state});

        // @see https://console.cloud.google.com/apis/api/logging.googleapis.com/quotas

        // When: filter includes a start date in the future OR nextPageToken points at a date slightly in the future (server seems to issue the nextPageToken and then waits a few seconds to pass).
        // The response is just HTTP 200 `{}`.
        if (_.keys(res).length === 0) {
            assert_true(state_map[states.WAITING_FOR_FUTURE_EVENT]);
            // console.log({res});
            console.log("Server returned empty JSON object. Reasons: (1) Filter start date in the future (2) nextPageToken waiting for new entries (3) resourceNames invalid. Retrying.", {state});

            if (page_history_count_last_x(states.WAITING_FOR_FUTURE_EVENT) > 2) {
                console.log("Reached the same page type limit.", {kind: states.WAITING_FOR_FUTURE_EVENT});
                break;
            }

            await sleep(wait_ms);
            continue;
        }


        const {entries = null, nextPageToken = null} = res;

        // Entries returned in this block are for the page this_page_token.
        const this_page_token = pageToken;


        if (_.isString(nextPageToken)) {
            pageToken = nextPageToken;
        } else {
            // Request same page token again if end reached and tail is true.
        }


        // When: Server is computing response.
        // Note: If the same request is made *without* the nextPageToken, the response is always empty.
        // - You must return the nextPageToken to continue the computation, or the server drops it.
        // Note: It can take up to 1 minute to compute a very simple query with just a few log entries.
        // - It can seem as if the request parameters are correct, but you just need to wait 30 to 60 seconds.
        // Docs: If a value for nextPageToken appears and the entries field is empty, it means that the search found no log entries so far but it did not have time to search all the possible log entries. Retry the method with this value for pageToken to continue the search. Alternatively, consider speeding up the search by changing your filter to specify a single log name or resource type, or to narrow the time range of the search.
        if (!("entries" in res)) {
            if (_.isString(nextPageToken)) {
                assert_true(state_map[states.WAITING_FOR_SERVER_TO_COMPUTE]);
                console.log("nextPageToken returned with no `entries` key. Server is computing query results, retrying.", {state});

                if (page_history_count_last_x(states.WAITING_FOR_SERVER_TO_COMPUTE) > 30) {
                    console.log("Reached the same page type limit.", {kind: states.WAITING_FOR_SERVER_TO_COMPUTE});
                    break;
                }

                await sleep(wait_ms);
                continue;
            } else {
                console.error(res);
                throw Error("Response had no `entries` and no `nextPageToken`. Should already of been handled at this point.");
            }
        }


        // When requesting the last page over and over to get new entries appended (when nextPageToken is null),
        // the page looks like it is only being appended to.
        // But items can be in one page, be absent in the next, and then present in the next again (only happens at the end of the log).
        // Rule: A page is only "finalised" when it has a nextPageToken.
        // This function will filter the entries already yielded from a previous end page download.
        // Note: An end page can transition to "finalised" when it has a nextPageToken (which may not be when the total-items-per-page is reached - just a random point that the server decides).


        if (_.isString(nextPageToken)) {
            // When: Regular page.
            if (entries.length > 0) {
                assert_true(state_map[states.FINAL_PAGE]);

                // Assumption: Once an ID is in a FINAL_PAGE it will not be in any future pages.
                console.info("No more entries to be added to this page.", {
                    state,
                    this_page_token: last_6(this_page_token),
                    nextPageToken: last_6(nextPageToken),
                    total_entries_in_page: entries.length
                });

                yield entries;
                continue;
            }


            throw Error("`nextPageToken` set with `entries=[]` should never happen.");
        }


        // When: Reached end of search.
        // When the end page is reached, keep requesting the same pageToken but only `yield` the new entries appended to the end.
        // @todo/low Possible optimization: Add/edit the from timestamp OR make entry limit lower when tailing to prevent downloading redundant bytes over and over (depends on log throughput).
        if (nextPageToken === null) {
            yield entries;

            assert_true(state_map[states.IN_PROGRESS_PAGE]);
            console.info("Logs are being appended to this page (no nextPageToken = page not finalised).", {
                state,
                this_page_token: last_6(this_page_token),
                nextPageToken: last_6(nextPageToken),
                total_entries_in_page: entries.length
            });

            break;
        }


        throw Error("Unhandled state");
    }
}

const last_6 = (x) => _.isString(x) ? x.slice(x.length - 6) : x;


export {
    get_all
}