# Obsidian PDF Editor

一个基于 pdf.js 的 Obsidian PDF 编辑插件，支持在 Obsidian 中直接查看和编辑 PDF 文件。

## ✨ 功能特性

### 📖 PDF 查看
- **多页渲染**：支持完整 PDF 文档渲染
- **缩放控制**：支持 25% - 500% 缩放范围
- **页面导航**：快速跳转到指定页面
- **缩略图面板**：可视化页面导航
- **大纲支持**：自动解析 PDF 书签目录

### ✏️ 编辑工具
- **文本注释**：在 PDF 任意位置添加文本注释
- **高亮标注**：选择文本进行高亮标记
- **画笔绘图**：自由手绘标注
- **橡皮擦**：擦除手绘内容
- **备注标记**：添加可点击的备注图标

### 💾 数据管理
- **自动保存**：可配置的自动保存间隔
- **独立存储**：注释数据以 JSON 格式独立保存
- **非破坏性**：不修改原始 PDF 文件

## 🚀 安装

### 手动安装
1. 下载插件文件（`main.js`、`manifest.json`、`styles.css`）
2. 将文件复制到 Obsidian 库的 `.obsidian/plugins/obsidian-pdf-editor/` 目录
3. 在 Obsidian 设置中启用插件

### 从源码构建
```bash
# 克隆仓库
git clone <repository-url>
cd obsidian-pdf-editor

# 安装依赖
npm install

# 开发模式（监视文件变化）
npm run dev

# 生产构建
npm run build
```

## 📖 使用方法

### 打开 PDF 文件
- **方式一**：在文件浏览器中双击 PDF 文件
- **方式二**：右键点击 PDF 文件 → "Open in PDF Editor"
- **方式三**：使用命令面板（Ctrl/Cmd+P）→ "Open PDF in Editor"

### 工具栏功能

| 图标 | 功能 | 快捷键 |
|------|------|--------|
| 📋 | 切换侧边栏 | - |
| ◀ | 上一页 | - |
| ▶ | 下一页 | - |
| 🔍- | 缩小 | - |
| 🔍+ | 放大 | - |
| ⬜ | 适应宽度 | - |
| 👆 | 选择工具 | - |
| 📝 | 文本工具 | - |
| 🖍️ | 高亮工具 | - |
| ✏️ | 画笔工具 | - |
| 🧹 | 橡皮擦 | - |
| 💬 | 备注工具 | - |

### 添加注释
1. 选择工具栏中的注释工具（文本、高亮、画笔等）
2. 在 PDF 页面上点击或拖拽创建注释
3. 文本注释：点击位置后输入内容
4. 高亮注释：先选择文本，然后应用高亮
5. 画笔注释：按住鼠标拖拽绘制

### 保存注释
- **自动保存**：在设置中启用后，注释会自动保存
- **手动保存**：使用命令 "Save PDF Annotations"
- **保存位置**：注释保存在 PDF 文件旁边的 `.annotations.json` 文件中

## ⚙️ 设置选项

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| 默认缩放比例 | 1.0 | 打开 PDF 时的初始缩放 |
| 启用注释 | true | 允许添加注释 |
| 启用文本编辑 | false | 实验性文本编辑功能 |
| 显示侧边栏 | true | 默认显示侧边栏 |
| 高亮颜色 | #FFFF00 | 高亮注释颜色 |
| 画笔颜色 | #FF0000 | 画笔颜色 |
| 画笔大小 | 2 | 画笔粗细 |
| 自动保存 | true | 启用自动保存 |
| 自动保存间隔 | 5000ms | 自动保存时间间隔 |

## 🔧 开发

### 项目结构
```
obsidian-pdf-editor/
├── src/
│   ├── main.ts          # 插件入口
│   ├── pdf-view.ts      # PDF 视图组件
│   └── settings.ts      # 设置管理
├── styles.css           # 插件样式
├── manifest.json        # Obsidian 插件清单
├── package.json         # 项目依赖
├── tsconfig.json        # TypeScript 配置
└── esbuild.config.mjs   # 构建配置
```

### 技术栈
- **pdf.js**：Mozilla 的 PDF 渲染库
- **TypeScript**：类型安全的 JavaScript
- **esbuild**：快速构建工具
- **Obsidian API**：Obsidian 插件开发接口

### 开发命令
```bash
# 开发模式（监视文件变化并自动构建）
npm run dev

# 生产构建
npm run build

# 更新版本号
npm version patch/minor/major
```

## 📝 注释文件格式

注释以 JSON 格式保存在 `.annotations.json` 文件中：

```json
{
  "1": [
    {
      "id": "text-1234567890",
      "type": "text",
      "pageIndex": 1,
      "x": 100,
      "y": 200,
      "width": 150,
      "height": 30,
      "content": "这是注释内容"
    },
    {
      "id": "highlight-1234567891",
      "type": "highlight",
      "pageIndex": 1,
      "x": 50,
      "y": 150,
      "width": 200,
      "height": 20,
      "color": "#FFFF00"
    }
  ]
}
```

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License
