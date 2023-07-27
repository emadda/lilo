import {get_auth_token_cached} from "./util";


const write = async (opts, entries) => {
    const at = get_auth_token_cached();

    const req = await fetch(`https://logging.googleapis.com/v2/entries:write`, {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${at}`
        },

        // @see https://cloud.google.com/logging/docs/reference/v2/rest/v2/entries/write
        body: JSON.stringify({
            // E.g. "projects/x/logs/test-log-01"
            "logName": opts.logName,
            // "resource": {
            //     object (MonitoredResource)
            // },
            // "labels": {
            //     string: string,
            //     ...
            // },
            entries,
            "partialSuccess": false,
            "dryRun": false
        })
    });


    const res = await req.text();
    if (!req.ok) {
        console.error({res});
    }


    return req.ok;
};


export {
    write
}