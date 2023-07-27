const log_cols = [
    // Custom.
    // Note: rowid is always created so no extra space is taken.
    {name: `log_id`, type: `INTEGER PRIMARY KEY`},
    {name: `run_id`, type: `INTEGER`},

    {name: "insertId", type: "TEXT UNIQUE"},
    {name: "severity", type: "TEXT"},
    {name: "textPayload", type: "TEXT"},
    {name: "jsonPayload", type: "TEXT"},
    {name: "protoPayload", type: "TEXT"},
    {name: "receiveTimestamp", type: "TEXT"},
    {name: "timestamp", type: "TEXT"},
    {name: "resource", type: "TEXT"},
    {name: "logName", type: "TEXT"},
    {name: "labels", type: "TEXT"},
    {name: "trace", type: "TEXT"}

];

// insertId,logName,severity,textPayload,protoPayload,receiveTimestamp,timestamp,resource,labels,trace

const config = {
    log_cols,
    log_cols_csv: log_cols.map(x => x.name).join(","),
    log_cols_sql_types: log_cols.map(x => `${x.name} ${x.type}`).join(", ")
}


const get_cols = () => {
    return log_cols.map((x) => x.name)
}

export {
    config,
    get_cols
}