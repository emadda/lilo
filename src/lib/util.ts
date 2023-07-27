const is_dev = () => {
    const is_env_set = "NODE_ENV" in process.env;

    if (!is_env_set) {
        return true;
    }

    return (
        process.env["NODE_ENV"] === 'development'
    )
}


const sleep = async (ms) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
};


export {
    is_dev,
    sleep
}