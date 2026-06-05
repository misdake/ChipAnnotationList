const fs = require("fs");
const path = require("path");
const express = require("express");

const ROOT = __dirname;
const PUBLIC_ROOT = path.join(ROOT, "public");
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const IDENTITY_FIELDS = ["vendor", "type", "family", "name"];

let state;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2));
  fs.renameSync(temporaryPath, filePath);
}

function directoryFromListItem(item) {
  try {
    const parts = new URL(item.url).pathname.split("/").filter(Boolean);
    return decodeURIComponent(parts[parts.length - 1]);
  } catch {
    return item.name;
  }
}

function recordId(repo, directoryName) {
  return `${repo}::${directoryName}`;
}

function issuesFor(record) {
  const issues = [];
  if (!record.list) issues.push({ code: "missing-list", label: "缺少 list" });
  if (!record.content) issues.push({ code: "missing-content", label: "缺少 content" });

  if (record.list && record.content) {
    for (const field of IDENTITY_FIELDS) {
      if ((record.list[field] ?? "") !== (record.content[field] ?? "")) {
        issues.push({ code: `mismatch-${field}`, label: `${field} 不一致` });
      }
    }
  }

  if (record.list && directoryFromListItem(record.list) !== record.directoryName) {
    issues.push({ code: "url-directory", label: "list.url 与目录不一致" });
  }
  return issues;
}

function publicRecord(record) {
  return {
    id: record.id,
    repo: record.repo,
    directoryName: record.directoryName,
    list: record.list,
    content: record.content,
    issues: issuesFor(record),
  };
}

function loadState() {
  const repoNames = fs
    .readFileSync(path.join(ROOT, "repos.txt"), "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const repos = new Map();
  const records = new Map();

  for (const repo of repoNames) {
    const repoPath = path.resolve(ROOT, "..", repo);
    const listPath = path.join(repoPath, "list.json");
    if (!fs.existsSync(repoPath) || !fs.existsSync(listPath)) {
      throw new Error(`无法读取仓库或 list.json: ${repoPath}`);
    }

    const list = readJson(listPath);
    repos.set(repo, { name: repo, path: repoPath, list });

    list.forEach((item, listIndex) => {
      const directoryName = directoryFromListItem(item);
      const id = recordId(repo, directoryName);
      const record = records.get(id) || { id, repo, directoryName };
      record.list = item;
      record.listIndex = listIndex;
      records.set(id, record);
    });

    for (const entry of fs.readdirSync(repoPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const contentPath = path.join(repoPath, entry.name, "content.json");
      if (!fs.existsSync(contentPath)) continue;
      const id = recordId(repo, entry.name);
      const record = records.get(id) || { id, repo, directoryName: entry.name };
      record.content = readJson(contentPath);
      record.contentPath = contentPath;
      records.set(id, record);
    }
  }

  state = { repoNames, repos, records };
}

function rebuildAggregateList() {
  const byName = new Map();
  for (const repo of state.repoNames) {
    for (const item of state.repos.get(repo).list) byName.set(item.name, item);
  }
  const result = [...byName.values()].sort((a, b) => {
    const left = `${a.vendor}-${a.type}-${a.family}-${a.name}`;
    const right = `${b.vendor}-${b.type}-${b.family}-${b.name}`;
    return left.localeCompare(right);
  });
  writeJson(path.join(ROOT, "list.json"), result);
}

function saveRecord(record, listValue, contentValue) {
  const repo = state.repos.get(record.repo);
  if (!repo) throw new Error("仓库不存在");

  if (listValue !== undefined) {
    if (!listValue || typeof listValue !== "object" || Array.isArray(listValue)) {
      throw new Error("list 必须是对象");
    }
    if (record.list && Object.prototype.hasOwnProperty.call(record.list, "url")) {
      listValue.url = record.list.url;
    }
    if (record.listIndex === undefined) {
      record.listIndex = repo.list.length;
      repo.list.push(listValue);
    } else {
      repo.list[record.listIndex] = listValue;
    }
    record.list = listValue;
    writeJson(path.join(repo.path, "list.json"), repo.list);
  }

  if (contentValue !== undefined) {
    if (!contentValue || typeof contentValue !== "object" || Array.isArray(contentValue)) {
      throw new Error("content 必须是对象");
    }
    if (record.content && Object.prototype.hasOwnProperty.call(record.content, "name")) {
      contentValue.name = record.content.name;
    }
    const directoryPath = path.join(repo.path, record.directoryName);
    const resolvedDirectory = path.resolve(directoryPath);
    if (path.dirname(resolvedDirectory) !== repo.path) throw new Error("目录路径无效");
    fs.mkdirSync(resolvedDirectory, { recursive: true });
    record.contentPath = path.join(resolvedDirectory, "content.json");
    record.content = contentValue;
    writeJson(record.contentPath, contentValue);
  }

  rebuildAggregateList();
  return publicRecord(record);
}

function dataResponse() {
  const records = [...state.records.values()]
    .map(publicRecord)
    .sort((a, b) => {
      const left = `${a.list?.vendor || a.content?.vendor || ""}-${a.list?.name || a.content?.name || a.directoryName}`;
      const right = `${b.list?.vendor || b.content?.vendor || ""}-${b.list?.name || b.content?.name || b.directoryName}`;
      return left.localeCompare(right);
    });
  return { repos: state.repoNames, records };
}

loadState();
const app = express();

app.use(express.json({ limit: "2mb" }));

app.get("/api/data", (_request, response) => {
  response.json(dataResponse());
});

app.post("/api/reload", (_request, response) => {
  loadState();
  response.json(dataResponse());
});

app.put("/api/chips", (request, response) => {
  const record = state.records.get(request.body.id);
  if (!record) throw new Error("芯片记录不存在");
  response.json(saveRecord(record, request.body.list, request.body.content));
});

app.use(express.static(PUBLIC_ROOT));

app.use("/api", (_request, response) => {
  response.status(404).json({ error: "接口不存在" });
});

app.use((error, _request, response, _next) => {
  const message = error instanceof SyntaxError && error.type === "entity.parse.failed"
    ? "JSON 请求格式无效"
    : error.message;
  console.error(`Request failed: ${message}`);
  response.status(400).json({ error: message });
});

app.listen(PORT, HOST, () => {
  console.log(`Chip editor: http://${HOST}:${PORT}`);
  console.log(`Loaded ${state.records.size} chips from ${state.repoNames.length} repositories.`);
});
