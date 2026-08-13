import {readFile, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const toolDirectory = dirname(fileURLToPath(import.meta.url));
const stylesDirectory = join(toolDirectory, "..", "frontend", "src", "styles");
const sourcePath = join(stylesDirectory, "base.css");

// Ordered boundaries preserve the original cascade exactly while making each
// visual area discoverable for people who are new to the project.
const sections = [
    ["base-core.css", null],
    ["base-home-dashboard.css", ".hero-widgets {"],
    ["base-navigation.css", ".search-wrap {"],
    ["base-guides.css", ".catalog-guide {"],
    ["base-catalog.css", ".catalog-page {"],
    ["base-settings-base.css", ".settings-center-trigger {"],
    ["base-settings-modal.css", "/* Viewport-level settings layer: the modal is rendered through a body portal. */"],
    ["base-personalization.css", "/* User interface personalization. Values of 1 preserve the original design. */"],
    ["base-collections.css", "/* The resume label is a real button so keyboard and pointer users share one path. */"],
    ["base-feedback.css", "/* Unified, deliberately quiet feedback for API, disk, cloud and watch-party events. */"],
    ["base-cloud.css", "/* Google Drive settings --------------------------------------------------- */"],
    ["base-branding.css", "/* Shared AnimeSoul artwork: site, desktop window and installer use one mark. */"],
    ["base-settings-center.css", "/* Settings center: compact navigation, search and consistent control cards. */"],
];

const source = await readFile(sourcePath, "utf8");
const starts = sections.map(([name, marker], index) => {
    if (index === 0) return 0;
    const position = source.indexOf(marker);
    if (position < 0) throw new Error(`CSS boundary not found for ${name}: ${marker}`);
    return position;
});

if (!starts.every((position, index) => index === 0 || position > starts[index - 1])) {
    throw new Error("CSS boundaries are not in the expected order.");
}

const parts = sections.map((_, index) =>
    source.slice(starts[index], starts[index + 1] ?? source.length),
);

if (parts.join("") !== source) {
    throw new Error("CSS split changed the source content.");
}

await Promise.all(sections.map(([name], index) =>
    writeFile(join(stylesDirectory, name), parts[index], "utf8"),
));

const imports = sections
    .map(([name]) => `@import "./${name}";`)
    .join("\n");
await writeFile(sourcePath, `${imports}\n`, "utf8");

console.log(`Split base.css into ${sections.length} ordered modules.`);
