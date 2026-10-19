#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
从拾光课程表的适配脚本仓库拉取全部学校适配器，生成本地资源与索引。

源仓库  ShiGuangSchedule/shiguang_warehouse （MIT License, Copyright (c) 2025 星河欲转）
        index/root_index.yaml        全部学校的清单（id / 名称 / 首字母 / 资源目录）
        resources/<目录>/adapters.yaml   该学校的适配器元信息（名称 / 教务网址 / 脚本文件名）
        resources/<目录>/*.js            适配脚本本体

产物    android-app/android/app/src/main/assets/uniimport/schools/
            schools.json            索引：[{id,name,initial,sub,url,script,desc}]
            <目录>/<脚本>.js         全部适配脚本

跑法    GH_TOK=<令牌> python dev/fetch-schools.py
        不加令牌也能跑（匿名限流更严，可能中途 403，重跑即可续传）。
已存在的文件会跳过，可安全重跑。
"""
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

REPO = "ShiGuangSchedule/shiguang_warehouse"
BRANCH = "main"
TOKEN = os.environ.get("GH_TOK", "").strip()

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(
    ROOT, "android-app", "android", "app", "src", "main", "assets", "uniimport", "schools")

API = "https://api.github.com/repos/%s/contents/" % REPO


def api_raw(path, tries=4):
    """取仓库里某个文件的原始文本。"""
    url = API + path + "?ref=" + BRANCH
    for i in range(tries):
        req = urllib.request.Request(url)
        req.add_header("Accept", "application/vnd.github.v3.raw")
        req.add_header("User-Agent", "qingjian-fetch-schools")
        if TOKEN:
            req.add_header("Authorization", "token " + TOKEN)
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code in (403, 429):          # 限流：退避后重试
                time.sleep(3 * (i + 1))
                continue
            if e.code == 404:
                return None
            if i == tries - 1:
                raise
            time.sleep(2)
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(2)
    return None


# ---------- 极简 YAML 解析：这两个文件结构固定，不值得引入依赖 ----------

def parse_root_index(text):
    """解析 index/root_index.yaml 的 schools 列表。"""
    schools, cur = [], None
    for line in text.splitlines():
        m = re.match(r"^\s*-\s*id:\s*\"?([^\"#]+?)\"?\s*(?:#.*)?$", line)
        if m:
            cur = {"id": m.group(1).strip()}
            schools.append(cur)
            continue
        if cur is None:
            continue
        m = re.match(r"^\s*(name|initial|resource_folder):\s*\"?([^\"#]*?)\"?\s*(?:#.*)?$", line)
        if m:
            cur[m.group(1)] = m.group(2).strip()
    return [s for s in schools if s.get("resource_folder")]


def parse_adapters(text):
    """解析 resources/<目录>/adapters.yaml 的 adapters 列表。"""
    items, cur = [], None
    in_list = False
    for line in text.splitlines():
        if re.match(r"^adapters:", line):      # 有的文件写成 "adapters: #固定字段"
            in_list = True
            continue
        if not in_list:
            continue
        m = re.match(r"^\s*-\s*(adapter_id|[a-z_]+):\s*\"?([^\"#]*?)\"?\s*(?:#.*)?$", line)
        if m:
            key, val = m.group(1), m.group(2).strip()
            if key == "adapter_id":
                cur = {"adapter_id": val}
                items.append(cur)
            elif cur is not None:
                cur[key] = val
            continue
        if cur is not None:
            m = re.match(r"^\s{4,}([a-z_]+):\s*\"?([^\"#]*?)\"?\s*(?:#.*)?$", line)
            if m:
                cur[m.group(1)] = m.group(2).strip()
    return [a for a in items if a.get("adapter_id") and a.get("asset_js_path")]


def main():
    if not os.path.isdir(OUT):
        os.makedirs(OUT)

    print("读取 index/root_index.yaml ...")
    root_txt = api_raw("index/root_index.yaml")
    if not root_txt:
        print("取不到根索引，终止", file=sys.stderr)
        return 1
    schools = parse_root_index(root_txt)
    print("根索引共 %d 项" % len(schools))

    entries, failed, skipped = [], [], []
    for n, s in enumerate(schools, 1):
        folder = s["resource_folder"]
        if folder == "GLOBAL_TOOLS":      # 通用工具目录，不是学校
            skipped.append(folder)
            continue
        yml = api_raw("resources/%s/adapters.yaml" % folder)
        if not yml:
            failed.append(folder + " (无 adapters.yaml)")
            continue
        ads = parse_adapters(yml)
        if not ads:
            failed.append(folder + " (adapters.yaml 无可用条目)")
            continue
        for a in ads:
            js_name = a["asset_js_path"]
            rel = "%s/%s" % (folder, js_name)
            dst = os.path.join(OUT, folder, js_name)
            if not os.path.exists(dst):
                if not os.path.isdir(os.path.dirname(dst)):
                    os.makedirs(os.path.dirname(dst))
                src = api_raw("resources/" + rel)
                if src is None:
                    failed.append(rel + " (脚本下载失败)")
                    continue
                io.open(dst, "w", encoding="utf-8", newline="").write(src)
            entries.append({
                "id": a["adapter_id"],
                "name": s.get("name", folder),
                "sub": a.get("adapter_name", ""),
                "initial": (s.get("initial") or "#").upper(),
                "url": a.get("import_url", ""),
                "script": rel,
                "desc": a.get("description", ""),
                "cat": a.get("category", ""),      # BACHELOR_AND_ASSOCIATE / POSTGRADUATE / GENERAL_TOOL
                "by": a.get("maintainer", ""),
            })
        if n % 25 == 0:
            print("  已处理 %d/%d 所学校，脚本 %d 个" % (n, len(schools), len(entries)))

    entries.sort(key=lambda x: (x["initial"], x["name"], x["id"]))
    idx = os.path.join(OUT, "schools.json")
    io.open(idx, "w", encoding="utf-8").write(
        json.dumps({"schools": entries}, ensure_ascii=False, separators=(",", ":")))

    total = sum(
        os.path.getsize(os.path.join(dp, f))
        for dp, _, fs in os.walk(OUT) for f in fs if f.endswith(".js"))
    print("\n完成：学校 %d 所，适配器 %d 个，脚本合计 %.2f MB"
          % (len(set(e["name"] for e in entries)), len(entries), total / 1048576.0))
    print("索引：%s" % idx)
    if skipped:
        print("跳过（非学校）：" + ", ".join(skipped))
    if failed:
        print("失败 %d 项：" % len(failed), file=sys.stderr)
        for f in failed[:20]:
            print("  " + f, file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
