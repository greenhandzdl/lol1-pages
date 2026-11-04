# lol1.moe · 萝莉图鉴

一本关于 12 位幻想小小居民的静态图鉴。全年龄、SFW、无广告、无追踪。

线上地址：<https://lol1.moe>

## 这是什么

- 12 位原创角色，每张插画都配有名字、档案、标签与生成信息
- 搜索、标签筛选、排序、收藏（只存在浏览器 `localStorage`）
- 明暗双主题、详情弹窗、URL 状态同步（可分享 `?id=sakura`、`?tag=书`）
- 纯静态、零构建、零第三方脚本、无 Cookie
- **3D 手办台**（`/3d/`）：拖拽旋转、双指缩放、键盘操作，外加一局「寻星」小游戏

## 技术栈

HTML + CSS + Vanilla JS（ES modules）+ 一份 JSON 数据。没有框架、没有构建步骤、没有 CDN。

```
.
├── index.html               # 单页应用
├── 3d/index.html            # 3D 手办台
├── 404.html                 # 404 页
├── favicon.svg
├── robots.txt
├── sitemap.xml
├── CNAME                    # lol1.moe
├── assets/
│   ├── css/style.css
│   ├── css/stage.css        # 3D 页样式
│   ├── js/main.js
│   ├── js/stage/            # 3D 模块（按需动态加载）
│   │   ├── app.js           # 页面入口
│   │   ├── capability.js    # 能力探测（不依赖 three）
│   │   ├── viewer.js        # 视图生命周期
│   │   ├── stage.js         # 渲染器/相机/灯光
│   │   ├── controls.js      # 指针/键盘交互
│   │   ├── rig.js           # 模型归一化
│   │   ├── figure.js        # 素色手办材质
│   │   ├── billboard.js     # 立牌降级
│   │   └── game.js          # 寻星小游戏
│   ├── data/characters.json # 12 位角色档案
│   ├── models/*.glb         # 3D 手办模型
│   └── img/
│       ├── og.jpg           # 社交分享图
│       └── works/*.webp     # 12 张插画（768×1024）
├── vendor/three/            # 预打包 three.js（不进首页）
└── scripts/3d/prepare-model.mjs  # 离线模型流水线
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

## 3D 手办台

线上入口：<https://lol1.moe/3d/>（首页导航与 hero 区都有入口）

### 交互

| 操作 | 桌面 | 移动 |
|---|---|---|
| 旋转 | 拖拽 / `←` `→` | 单指拖拽 |
| 缩放 | 滚轮 | 双指捏合 |
| 换角色 | `←` `→`（焦点不在画布时）或面板按钮 | 面板按钮 |
| 游戏 | 「开始寻星」，45 秒内找到 3 颗星 | 同左 |

极角限制在 18°–80°，不会转到地板下面；带惯性与回弹阻尼。

### 性能与降级

3D 相关代码**全部动态 import**，首页不含 three.js：

- `navigator.connection.saveData` 或 `effectiveType` 为 `2g/slow-2g` → 不下载 three.js，直接走图片模式
- 无 WebGL 上下文 → 同上
- 模型加载失败 → 回落到该角色的 2D 插画，页面不空白

能力探测放在独立的 `capability.js` 里（不 import three），否则 ES module 一加载就会把整个 three 拉下来，降级就失去意义了。

### 模型流水线

模型来自 Hunyuan3D 2.1，走 ComfyUI 侧的美化流程，再用 `scripts/3d/prepare-model.mjs` 做离线处理：

```bash
node scripts/3d/prepare-model.mjs in.glb out.glb
```

导出格式要点：glTF 磁盘坐标系。

> ⚠️ Blender 里看到模型「Z 轴朝上」是 glTF 导入器的 Y-up→Z-up 转换结果，**不是文件本身的朝向**。
> 文件内部实测已是 Y-up（Y span 1.96 / X 1.45 / Z 0.90），千万别在运行时再加 `rotation.x = -π/2`，否则会躺倒。

运行时只需要：居中 → 脚底对齐 `y=0` → 缩放到 1.8 世界单位（见 `rig.js`）。

个别模型的默认朝向不统一，用 `characters.json` 的 `modelYaw`（度）单独修正，目前 `umi=90`、`kanon=270`。

### 当前模型覆盖

12 位角色里 8 位有 3D 手办，其余 4 位（`chacha`、`suzuka`、`cream`、`hibari`）自动走立牌模式。

这不是偷懒：这几位用同一套流程生成出来的几何是塌的（糊成一坨、镂空成盒子、头身分离），
与其在页面上摆一个认不出是谁的模型，不如直接展示插画。补齐办法是换 seed 重跑，流程已经固化，重跑即可。

### 着色

不上 PBR 贴图，改用「素色手办」方案：单色纵向渐变 + 反向外壳描边 + 三点布光。
好处是不用依赖生成模型的 UV，侧转到背面也不会露出贴图接缝。

渐变的颜色由 `characters.json` 的 `palette` 推导，并压低了明度——直接用 UI 的浅色当底色会白成一片、看不清体积。
