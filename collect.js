const fs = require('fs');

let data = fs.readFileSync("repos.txt");
let lines = data.toString().split('\r\n').filter(line => line);

let all = lines.flatMap(line => {
    let data = fs.readFileSync(`../${line}/list.json`);
    let list = JSON.parse(data.toString());
    console.log("repo", line, "\tcount", list.length);
    return list;
});

let map = new Map();
all.forEach(item => map.set(item.name, item));
let result = new Array(...map.values());

fs.writeFileSync("list.json", JSON.stringify(result, null, 2));

console.log("total", result.length);
