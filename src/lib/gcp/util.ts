// Authentication
// @see https://stackoverflow.com/a/59766004/4949386
// @see https://stackoverflow.com/a/57122200/4949386
// @see https://gist.github.com/testpilot031/e68f8a0f16ebbb3bb23003153588fb4d

const get_auth_token = () => {
    const proc = Bun.spawnSync(["gcloud", "auth", "print-access-token"]);
    return proc.stdout.toString();
}

let auth_token_created_at = null;
let auth_token = null;
const is_auth_token_expired = () => {
    return (performance.now() - auth_token_created_at) > (60 * 1000 * 10)
}
const get_new_token = () => {
    auth_token = get_auth_token();
    auth_token_created_at = performance.now();

    return auth_token;
}


const get_auth_token_cached = () => {
    if (auth_token === null || is_auth_token_expired()) {
        get_new_token();
    }

    return auth_token;
}


// Use JS symbol to tag all places in source code keys are used.
const states = {
    WAITING_FOR_FUTURE_EVENT: `WAITING_FOR_FUTURE_EVENT`,
    WAITING_FOR_SERVER_TO_COMPUTE: `WAITING_FOR_SERVER_TO_COMPUTE`,
    FINAL_PAGE: `FINAL_PAGE`,
    IN_PROGRESS_PAGE: `IN_PROGRESS_PAGE`
}

export {
    get_auth_token_cached,
    get_new_token,
    states
}