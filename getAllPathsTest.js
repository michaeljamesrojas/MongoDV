const getAllPaths = (data, prefix = '') => {
    let paths = [];
    if (!data || typeof data !== 'object') return paths;

    // Handle Array
    if (Array.isArray(data)) {
        data.forEach((item, index) => {
            const currentPath = `${prefix ? prefix + '.' : ''}${index}`;
            if (typeof item === 'object' && item !== null) {
                paths.push(currentPath);
                paths = paths.concat(getAllPaths(item, currentPath));
            }
        });
        return paths;
    }

    // Handle Object
    Object.keys(data).forEach(key => {
        const value = data[key];
        const currentPath = `${prefix ? prefix + '.' : ''}${key}`;
        if (typeof value === 'object' && value !== null) {
            paths.push(currentPath);
            paths = paths.concat(getAllPaths(value, currentPath));
        }
    });

    return paths;
};

const testData = {
    _id: "123",
    simple: "value",
    nested: {
        a: 1,
        b: { c: 2 }
    },
    array: [
        1,
        { d: 3 }
    ]
};

console.log(getAllPaths(testData));
