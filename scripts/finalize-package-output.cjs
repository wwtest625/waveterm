const fs = require("fs");
const path = require("path");

function main() {
    const [sourceDirArg, destinationDirArg] = process.argv.slice(2);

    if (!sourceDirArg || !destinationDirArg) {
        console.error("Usage: node scripts/finalize-package-output.cjs <sourceDir> <destinationDir>");
        process.exit(1);
    }

    const sourceDir = path.resolve(sourceDirArg);
    const destinationDir = path.resolve(destinationDirArg);

    if (!fs.existsSync(sourceDir)) {
        return;
    }

    fs.mkdirSync(destinationDir, { recursive: true });

    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
        if (entry.name.endsWith("-unpacked")) {
            continue;
        }

        const sourcePath = path.join(sourceDir, entry.name);
        const destinationPath = path.join(destinationDir, entry.name);

        fs.rmSync(destinationPath, { recursive: true, force: true });
        fs.cpSync(sourcePath, destinationPath, { recursive: true, force: true, verbatimSymlinks: true });
        fs.rmSync(sourcePath, { recursive: true, force: true });
    }
}

main();
