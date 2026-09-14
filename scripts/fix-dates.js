#!/usr/bin/env node
// 一次性日期修正脚本:遍历 posts/*.md,用每个文件的 Git 最后提交日期强制统一 createdAt/updatedAt
// 用法:node scripts/fix-dates.js [--apply]
//   不带 --apply:只打印将要做的修改(dry-run)
//   带 --apply  :真正写入文件
//
// 解决问题:之前某些文章的 date/createdAt 写错(如 2026-08-14 / 2026-05-14),
// 现在统一以 Git 最后提交时间为准,保证日期准确有效
//
// 依赖:git 命令行(本仓库已是 git 仓库)

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const POSTS_DIR = path.join(__dirname, '..', 'posts');
const APPLY = process.argv.includes('--apply');

// 取一个文件的 Git 最后提交日期(ISO 格式 YYYY-MM-DD)
function gitLastCommitDate(file) {
  try {
    // %ci = committer date in ISO 8601;取前 10 位即 YYYY-MM-DD
    const out = execSync(`git log -1 --format=%ci -- "${file}"`, { cwd: path.dirname(file), encoding: 'utf8' });
    return out.trim().slice(0, 10);
  } catch (e) {
    return null;
  }
}

// 极简 frontmatter 解析(和 build.js 一致):返回 {data, body}
function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!m) return { data: {}, body: text };
  const data = {};
  const lines = m[1].split(/\r?\n/);
  lines.forEach(line => {
    if (!line.trim() || line.trim().startsWith('#')) return;
    const idx = line.indexOf(':');
    if (idx < 0) return;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    data[key] = val;
  });
  return { data, body: m[2] };
}

// 重建 frontmatter 文本(保留字段顺序,只改/补 createdAt/updatedAt)
function rebuildFrontmatter(data, body) {
  const lines = ['---'];
  const seen = new Set();
  Object.keys(data).forEach(k => {
    if (k === 'createdAt' || k === 'updatedAt') return; // 后面单独处理
    lines.push(`${k}: ${data[k]}`);
    seen.add(k);
  });
  lines.push(`createdAt: ${data.createdAt}`);
  lines.push(`updatedAt: ${data.updatedAt}`);
  lines.push('---');
  return lines.join('\n') + '\n' + body;
}

function run() {
  if (!fs.existsSync(POSTS_DIR)) {
    console.error('posts 目录不存在');
    process.exit(1);
  }
  const files = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.md'));
  if (!files.length) {
    console.log('posts 目录下没有 .md 文件');
    return;
  }
  console.log(`[fix-dates] 遍历 ${files.length} 个 .md 文件,${APPLY ? '将写入修改' : 'dry-run 模式(只打印)'}`);
  let changed = 0;
  let ok = 0;
  files.forEach(file => {
    const full = path.join(POSTS_DIR, file);
    const raw = fs.readFileSync(full, 'utf8');
    const { data, body } = parseFrontmatter(raw);
    const gitDate = gitLastCommitDate(full);
    if (!gitDate) {
      console.log(`  ✗ ${file}:无法获取 Git 提交时间,跳过`);
      return;
    }
    const oldCreated = data.createdAt || '';
    const oldUpdated = data.updatedAt || '';
    const newCreated = gitDate;
    const newUpdated = gitDate; // 最后提交时间既是更新时间
    if (oldCreated === newCreated && oldUpdated === newUpdated) {
      console.log(`  ✓ ${file}:日期已正确(${newCreated})`);
      ok++;
      return;
    }
    console.log(`  ! ${file}:需修改`);
    console.log(`    createdAt: ${oldCreated || '(空)'} → ${newCreated}`);
    console.log(`    updatedAt: ${oldUpdated || '(空)'} → ${newUpdated}`);
    changed++;
    if (APPLY) {
      const newData = { ...data, createdAt: newCreated, updatedAt: newUpdated };
      const out = rebuildFrontmatter(newData, body);
      fs.writeFileSync(full, out, 'utf8');
    }
  });
  console.log(`\n[fix-dates] 完成:已正确 ${ok} 篇,需修改 ${changed} 篇${APPLY ? '(已写入)' : '(dry-run,加 --apply 真正写入)'}`);
}

run();
