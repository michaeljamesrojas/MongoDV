const { ObjectId } = require('mongodb');

const testStrings = [
    "507f1f77bcf86cd799439011", // Valid ObjectId
    "507f1f77bcf86cd79943901",  // Too short
    "507f1f77bcf86cd7994390111", // Too long
    "000000000000000000000000", // Valid 24 hex
    "nonsenseStringWithLength",  // 24 chars but not hex?
    "123",
    123
];

testStrings.forEach(s => {
    const valid = ObjectId.isValid(s);
    console.log(`"${s}" (${typeof s}): isValid=${valid}`);
    if (valid && typeof s === 'string' && s.length === 24) {
        try {
            const oid = new ObjectId(s);
            console.log(`  -> Converted: ${oid}`);
        } catch (e) {
            console.log(`  -> Error converting`);
        }
    }
});
