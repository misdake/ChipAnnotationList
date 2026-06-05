const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const DRY_RUN = process.argv.includes("--dry-run");
const AUTHOR_RULES = [
  {
    sourcePrefix: "https://www.flickr.com/photos/130561288@N04/",
    authorName: "Fritzchens Fritz",
    authorUrl: "https://www.flickr.com/photos/130561288@N04/",
  },
  {
    sourcePrefix: "https://www.flickr.com/photos/98762402@N06/",
    authorName: "Oleg Kashirin",
    authorUrl: "https://www.flickr.com/photos/98762402@N06/",
  },
  {
    sourcePrefix: "https://www.flickr.com/photos/sic66/",
    authorName: "Martijn Boer",
    authorUrl: "https://www.flickr.com/photos/sic66/",
  },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2));
  fs.renameSync(temporaryPath, filePath);
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

const repoNames = fs
  .readFileSync(path.join(ROOT, "repos.txt"), "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

const errors = [];
let scanned = 0;
let matched = 0;
let updated = 0;
let unchanged = 0;

for (const repo of repoNames) {
  const repoPath = path.resolve(ROOT, "..", repo);
  for (const entry of fs.readdirSync(repoPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const contentPath = path.join(repoPath, entry.name, "content.json");
    if (!fs.existsSync(contentPath)) continue;
    scanned++;

    let content;
    try {
      content = readJson(contentPath);
    } catch (error) {
      errors.push({
        repo,
        chip: entry.name,
        file: contentPath,
        problems: [`无法读取 JSON: ${error.message}`],
      });
      continue;
    }

    const rule = AUTHOR_RULES.find(
      (candidate) =>
        typeof content.source === "string" &&
        content.source.startsWith(candidate.sourcePrefix) &&
        content.source.length > candidate.sourcePrefix.length
    );
    if (!rule) continue;
    matched++;

    const problems = [];
    if (hasValue(content.imageAuthorName) && content.imageAuthorName !== rule.authorName) {
      problems.push(`imageAuthorName: ${JSON.stringify(content.imageAuthorName)}`);
    }
    if (hasValue(content.imageAuthorUrl) && content.imageAuthorUrl !== rule.authorUrl) {
      problems.push(`imageAuthorUrl: ${JSON.stringify(content.imageAuthorUrl)}`);
    }

    if (problems.length) {
      errors.push({ repo, chip: entry.name, file: contentPath, problems });
      continue;
    }

    const needsUpdate =
      content.imageAuthorName !== rule.authorName ||
      content.imageAuthorUrl !== rule.authorUrl;
    if (!needsUpdate) {
      unchanged++;
      continue;
    }

    content.imageAuthorName = rule.authorName;
    content.imageAuthorUrl = rule.authorUrl;
    if (!DRY_RUN) writeJson(contentPath, content);
    updated++;
  }
}

console.log(DRY_RUN ? "模式: dry-run，不写入文件" : "模式: 写入文件");
console.log(`扫描 content.json: ${scanned}`);
console.log(`匹配 Flickr source: ${matched}`);
console.log(`${DRY_RUN ? "需要更新" : "已更新"}: ${updated}`);
console.log(`已经正确: ${unchanged}`);
console.log(`错误: ${errors.length}`);

if (errors.length) {
  console.log("\n错误列表:");
  errors.forEach((error, index) => {
    console.log(`${index + 1}. ${error.repo}/${error.chip}`);
    console.log(`   ${error.file}`);
    for (const problem of error.problems) console.log(`   - ${problem}`);
  });
  process.exitCode = 1;
}
