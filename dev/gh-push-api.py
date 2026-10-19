# -*- coding: utf-8 -*-
"""
用 GitHub Git Data API 推送提交 —— 本沙箱 `git push` 走不通时的替代方案。

为什么需要它
------------
本沙箱的出口代理只放行 api.github.com；github.com 的 git 智能 HTTP 通道
（`/info/refs`、`git-receive-pack`）返回 502 / 000，所以 `git push` 必定失败
（现象：无输出，被 SIGTERM；或 `CONNECT tunnel failed, response 502`）。
这里改为：逐个上传 blob → 建 tree → 建 commit → 更新 ref，效果与 push 等价。

关于 sha
--------
GitHub 会规范化作者/提交者的日期字段（`+08:00` → `Z`），所以新建 commit 的
sha 与本地不同 —— **但 tree 内容完全一致**（脚本末尾会校验并打印）。
对应关系记在 `.git/qj-api-sync.json`，下次推送用它算增量。

用法
----
    GH_TOK=<token> python dev/gh-push-api.py [tag]
    # 例：GH_TOK=ghp_xxx python dev/gh-push-api.py v0.1.7
    # 推到私人测试仓库：加 GH_REPO=HertaSta/QingJian-CourseTable-Test
    # （同一个仓库的增量起点按仓库名分开存，两个仓库互不干扰）
"""
import base64
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

REPO = os.environ.get("GH_REPO", "HertaSta/QingJian-CourseTable").strip()
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOKEN = os.environ.get("GH_TOK", "").strip()
API = "https://api.github.com"
BRANCH = "main"
SYNC = os.path.join(ROOT, ".git", "qj-api-sync-%s.json" % REPO.replace("/", "_"))

if not TOKEN:
    raise SystemExit("请通过环境变量 GH_TOK 提供令牌")


def git(*args, binary=False, check=True):
    r = subprocess.run(["git"] + list(args), cwd=ROOT,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if check and r.returncode != 0:
        raise RuntimeError("git %s 失败：%s"
                           % (" ".join(args), r.stderr.decode("utf-8", "replace")))
    return r.stdout if binary else r.stdout.decode("utf-8", "replace")


def api(method, path, payload=None, tries=3):
    url = API + path
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    last = None
    for i in range(tries):
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", "Bearer " + TOKEN)
        req.add_header("Accept", "application/vnd.github+json")
        req.add_header("X-GitHub-Api-Version", "2022-11-28")
        if data:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=300) as resp:
                raw = resp.read()
                return json.loads(raw.decode("utf-8")) if raw else {}
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")
            if e.code >= 500 and i < tries - 1:
                last = "HTTP %s %s" % (e.code, body[:200])
                continue
            raise RuntimeError("API %s %s -> HTTP %s\n%s"
                               % (method, path, e.code, body[:800]))
        except Exception as e:
            last = repr(e)
            if i < tries - 1:
                continue
            raise
    raise RuntimeError(last or "unknown")


def ls_tree(commit):
    out = git("ls-tree", "-r", "-z", commit, binary=True)
    d = {}
    for rec in out.split(b"\0"):
        if not rec:
            continue
        meta, path = rec.split(b"\t", 1)
        mode, _typ, sha = meta.split(b" ")
        d[path.decode("utf-8", "surrogateescape")] = (mode.decode(), sha.decode())
    return d


def changes(commit):
    out = git("diff-tree", "-r", "--no-commit-id", "--name-status",
              "--no-renames", "-z", commit, binary=True)
    parts = out.split(b"\0")
    res, i = [], 0
    while i + 1 < len(parts):
        st = parts[i].decode()
        path = parts[i + 1].decode("utf-8", "surrogateescape")
        if st and path:
            res.append((st[0], path))
        i += 2
    return res


def main():
    tag = sys.argv[1] if len(sys.argv) > 1 else None

    ref = api("GET", "/repos/%s/git/ref/heads/%s" % (REPO, BRANCH))
    base_commit = ref["object"]["sha"]
    base_tree = api("GET", "/repos/%s/git/commits/%s"
                    % (REPO, base_commit))["tree"]["sha"]
    print("远端 %s   = %s" % (BRANCH, base_commit))
    print("远端 tree = %s" % base_tree)

    boundary = base_commit
    if os.path.exists(SYNC):
        try:
            with open(SYNC, encoding="utf-8") as f:
                boundary = json.load(f).get("local_base") or base_commit
        except Exception:
            pass
    probe = git("rev-parse", "--verify", "-q", boundary + "^{commit}", check=False).strip()
    if not probe:
        print("!! 本地没有 %s 这个对象，无法算增量；请手动指定边界" % boundary[:10])
        return
    print("增量起点  = %s（本地）" % boundary[:10])

    commits = git("rev-list", "--reverse", boundary + "..HEAD").split()
    print("待推送    = %d 笔 %s" % (len(commits), [c[:8] for c in commits]))
    if not commits:
        print("没有需要推送的提交")
    else:
        fmt = "%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%B"
        for n, c in enumerate(commits, 1):
            chg = changes(c)
            tree_map = ls_tree(c)
            entries, blobs = [], 0
            for st, path in chg:
                if st == "D":
                    entries.append({"path": path, "mode": "100644",
                                    "type": "blob", "sha": None})
                    continue
                if path not in tree_map:
                    continue
                mode, sha = tree_map[path]
                content = git("cat-file", "blob", sha, binary=True)
                r = api("POST", "/repos/%s/git/blobs" % REPO, {
                    "content": base64.b64encode(content).decode("ascii"),
                    "encoding": "base64"})
                entries.append({"path": path, "mode": mode,
                                "type": "blob", "sha": r["sha"]})
                blobs += 1
                print("   [%s] %-52s %8d B" % (st, path, len(content)))
                sys.stdout.flush()

            new_tree = api("POST", "/repos/%s/git/trees" % REPO,
                           {"base_tree": base_tree, "tree": entries})
            m = git("log", "-1", "--format=" + fmt, c).split("\x00", 6)
            an, ae, ad, cn, ce, cd, msg = m
            new_commit = api("POST", "/repos/%s/git/commits" % REPO, {
                "message": msg.rstrip("\n"),
                "tree": new_tree["sha"],
                "parents": [base_commit],
                "author": {"name": an, "email": ae, "date": ad},
                "committer": {"name": cn, "email": ce, "date": cd}})
            print("[%d/%d] %s -> %s  条目 %d（上传 %d）"
                  % (n, len(commits), c[:8], new_commit["sha"][:8],
                     len(entries), blobs))
            sys.stdout.flush()
            base_commit = new_commit["sha"]
            base_tree = new_tree["sha"]

        api("PATCH", "/repos/%s/git/refs/heads/%s" % (REPO, BRANCH),
            {"sha": base_commit, "force": False})
        print("%s 已更新 -> %s" % (BRANCH, base_commit))

    local_tree = git("rev-parse", "HEAD^{tree}").strip()
    print("本地 HEAD tree = %s" % local_tree)
    print("远端 HEAD tree = %s" % base_tree)
    print("tree " + ("一致 ✓（内容完全相同）" if local_tree == base_tree
                     else "不一致 ⚠（内容有偏差，请检查）"))

    if tag:
        tdate = git("log", "-1", "--format=%cI", "HEAD").strip()
        tag_obj = api("POST", "/repos/%s/git/tags" % REPO, {
            "tag": tag, "message": "清笺课程表 " + tag,
            "object": base_commit, "type": "commit",
            "tagger": {"name": "HertaSta",
                       "email": "HertaSta@users.noreply.github.com",
                       "date": tdate}})
        api("POST", "/repos/%s/git/refs" % REPO,
            {"ref": "refs/tags/" + tag, "sha": tag_obj["sha"]})
        print("tag %s 已创建 -> %s" % (tag, tag_obj["sha"][:10]))

    with open(SYNC, "w", encoding="utf-8") as f:
        json.dump({"remote_head": base_commit, "remote_tree": base_tree,
                   "local_base": git("rev-parse", "HEAD").strip(),
                   "tag": tag or ""}, f, ensure_ascii=False, indent=2)
    print("同步记录已更新：" + os.path.basename(SYNC))
    print("DONE")


if __name__ == "__main__":
    main()
