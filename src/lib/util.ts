const is_dev = () => {
    // process.env["NODE_ENV"]
    // - Bun replaces this with "development" by default.
    // - "production" cannot be set via shebang or via package.json `bin` value.

    return false;
}


const sleep = async (ms) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
};


export {
    is_dev,
    sleep
}