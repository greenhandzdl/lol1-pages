# lol1.moe · 萝莉图鉴

一本关于 12 位幻想小小居民的静态图鉴。全年龄、SFW、无广告、无追踪。

线上地址：<https://lol1.moe>

## 这是什么

- 12 位原创角色，每张插画都配有名字、档案、标签与生成信息
- 搜索、标签筛选、排序、收藏（只存在浏览器 `localStorage`）
- 明暗双主题、详情弹窗、URL 状态同步（可分享 `?id=sakura`、`?tag=书`）
- 纯静态、零构建、零第三方脚本、无 Cookie

## 技术栈

HTML + CSS + Vanilla JS（ES modules）+ 一份 JSON 数据。没有框架、没有构建步骤、没有 CDN。

```
.
├── index.html               # 单页应用
├── 404.html                 # 404 页
├── favicon.svg
├── robots.txt
├── sitemap.xml
├── CNAME                    # lol1.moe
└── assets/
    ├── css/style.css
    ├── js/main.js
    ├── data/characters.json # 12 位角色档案
    └── img/
        ├── og.jpg           # 社交分享图
        └── works/*.webp     # 12 张插画（768×1024）
```

## 本地预览

```bash
python3 -m http.server 8788
# http://127.0.0.1:8788/
```

因为数据通过 `fetch` 加载，直接双击 `index.html` 不行，需要起一个静态服务器。

## 插画

12 张插画由本机 ComfyUI 的 **Anima** 模型生成（`anima-preview3-base` + Qwen3 文本编码器），每张图在角色档案里标注了生成方式与种子。角色均为虚构，画面为非性化的可爱向作品。

## 内容政策

- 本站为全年龄（SFW）站点，仅展示非性化的可爱向作品
- 所有插画由 AI 生成，不涉及真实人物
- 本站不使用 Cookie、不加载第三方脚本、不收集访问数据
- 如认为某张图片或文字不妥，请开 [Issue](https://github.com/greenhandzdl/lol1-pages/issues)，核实后会立即处理

## 部署

GitHub Pages，`main` 分支根目录，自定义域名 `lol1.moe`（见 `CNAME`）。

## License

代码以 [MIT](LICENSE) 协议开放；插画为 AI 生成作品，仅供欣赏。
