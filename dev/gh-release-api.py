# -*- coding: utf-8 -*-
"""用 GitHub API 创建 Release 并上传 APK —— 本沙箱 github.com 的 git 通道不通时的发布方式。

api.github.com（建 Release）与 uploads.github.com（传附件）都被代理放行，
所以发布走 REST API；注意 **附件名必须用英文**，GitHub 会删掉非 ASCII 字符。

用法
----
    GH_TOK=<token> python dev/gh-release-api.py <tag> <说明文件> <apk路径> <附件英文名>

例
    GH_TOK=ghp_xxx python dev/gh-release-api.py v0.1.7 dev/_body.md \
        "历史版本/清笺课程表-v0.1.7.apk" QingJian-CourseTable-v0.1.7.apk

已存在同名 Release / 附件时会跳过，可安全重跑。
"""
import json
import os
import sys
import urllib.error
import urllib.request

REPO = "HertaSta/QingJian-CourseTable"
TOKEN = os.environ.get("GH_TOK", "").strip()

if not TOKEN:
    raise SystemExit("请通过环境变量 GH_TOK 提供令牌")
if len(sys.argv) < 5:
    raise SystemExit(__doc__)

TAG = sys.argv[1]
BODY_FILE = sys.argv[2]
APK = sys.argv[3]
ASSET_NAME = sys.argv[4]


def api(method, url, payload=None, raw=None, content_type=None, timeout=900):
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        content_type = "application/json"
    elif raw is not None:
        data = raw
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    if content_type:
        req.add_header("Content-Type", content_type)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            b = r.read()
            return json.loads(b.decode("utf-8")) if b else {}
    except urllib.error.HTTPError as e:
        raise RuntimeError("HTTP %s %s\n%s"
                           % (e.code, url, e.read().decode("utf-8", "replace")[:600]))


def main():
    body = open(BODY_FILE, encoding="utf-8").read()
    try:
        rel = api("GET", "https://api.github.com/repos/%s/releases/tags/%s" % (REPO, TAG))
        print("Release 已存在 id=%s" % rel["id"])
    except RuntimeError as e:
        if "HTTP 404" not in str(e):
            raise
        rel = api("POST", "https://api.github.com/repos/%s/releases" % REPO, {
            "tag_name": TAG, "target_commitish": "main", "name": TAG,
            "body": body, "draft": False, "prerelease": False})
        print("Release 已创建 id=%s" % rel["id"])
    rid = rel["id"]

    rel = api("GET", "https://api.github.com/repos/%s/releases/%s" % (REPO, rid))
    names = [a["name"] for a in rel["assets"]]
    print("现有附件:", names)
    if ASSET_NAME in names:
        print("附件已存在，跳过上传:", ASSET_NAME)
        return

    data = open(APK, "rb").read()
    print("本地 APK %d 字节，开始上传…" % len(data))
    sys.stdout.flush()
    a = api("POST",
            "https://uploads.github.com/repos/%s/releases/%s/assets?name=%s"
            % (REPO, rid, ASSET_NAME),
            raw=data, content_type="application/vnd.android.package-archive")
    print("附件已上传:", a["name"], a["size"], "bytes")
    print("digest:", a.get("digest"))
    print("DONE")


if __name__ == "__main__":
    main()
