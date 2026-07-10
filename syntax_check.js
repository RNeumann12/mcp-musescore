const fs = require('fs');
const code = fs.readFileSync('mcp-logic.js', 'utf8');

try {
    new Function(`return ${code};`);
    console.log("mcp-logic.js syntax check passed.");
} catch(e) {
    console.log("JS Syntax check:", e);
    process.exitCode = 1;
}
