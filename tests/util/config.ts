const config = {
    project_id: Bun.env["LILO_GCP_PROJECT"],
}

const get_log_name = (log_id) => {
    return `projects/${config.project_id}/logs/${log_id}`;
}

export {
    config,
    get_log_name
}