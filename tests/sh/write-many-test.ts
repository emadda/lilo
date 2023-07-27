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
    return proc;
}

const run_one = () => {
    const proc = run_cmd([
        "./util/write-many.ts",
        JSON.stringify({
            log_id: "test-01",
            total_http_requests: 10,
            log_entries_per_request: [1, 1],
            start_at_iso_date: new Date().toISOString()
        }),
    ]);
    return proc;
}


await run_one();
