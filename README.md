# IRC Log Studio

IRC Log Studio 是 Windows 本地桌面编辑器。你可以用中文界面编写 IRC 风格的日志，在频道之间切换，管理用户档案，再将日志导出为文本或结构化项目。应用离线运行。

## 安装依赖

1. 安装 Node.js 24 或更新版本。
2. 安装 pnpm 10.30.3，例如运行 `npm install --global pnpm@10.30.3`。
3. 安装 Windows 版 Rust，选择 MSVC 工具链。
4. 安装 Visual Studio Build Tools，勾选「使用 C++ 的桌面开发」和 Windows SDK。
5. 如果系统缺少 Microsoft Edge WebView2 Runtime，请安装它。
6. 在项目目录运行 `pnpm install --frozen-lockfile`。

[Tauri Windows 构建前置条件](https://v2.tauri.app/start/prerequisites/)

## 运行和构建

```powershell
pnpm tauri dev
pnpm tauri build
```

开发命令会打开桌面窗口。构建命令将可执行文件写入 `src-tauri/target/release/`，将 NSIS 安装程序写入 `src-tauri/target/release/bundle/nsis/`。安装程序配置为包含 WebView2 离线安装组件。只构建可执行文件时，运行 `pnpm tauri build --no-bundle`。

## 使用

1. 展开顶部的项目名称，选择「新建项目」或「打开项目」。
2. 点击频道栏的加号，创建频道。
3. 在事件编辑器中选择事件类型并填写字段。
4. 点击「添加事件」。
5. 要修改历史事件，点击日志行，再点击「保存修改」。
6. 要删除历史事件，点击「删除事件」，再确认删除。

可以直接打开[示例项目](examples/Studio-demo.irclogproj)，查看两个频道和全部 16 种事件。日志支持选择、复制和长文本换行。

用户选择菜单优先显示当前频道成员。其他档案也可以直接选择。点击选择框旁的档案库按钮，可以搜索昵称、Username 或 Hostname，也可以新建并选中档案。已有事件保留创建时的昵称和 Hostmask。新增 NICK 事件会更新档案当前昵称。

新增事件默认使用提交时的本地时间。点击时间设置可以固定时间，适用于连续补录。编辑事件时保留原时间，除非手动修改。日志按记录顺序显示。

快捷键包括 `Ctrl+N` 新建项目、`Ctrl+O` 打开项目、`Ctrl+S` 保存和 `Ctrl+Shift+S` 另存为。编辑事件时，按 `Esc` 取消。焦点在文本控件外时，按 `Delete` 打开删除确认。

## 项目文件和自动存档

「保存」将结构化项目写入选择的 `.irclogproj` 文件。「另存为」将项目写入新路径。应用也可以打开符合相同结构的 `.json` 文件。版本字段为 `schemaVersion`。

项目或所选频道发生变化后，应用等待 650 毫秒再写入自动存档。正常关闭窗口前，应用会尝试写入等待中的改动。应用启动时会恢复上次工作区，主存档无法读取时会尝试备份。指定路径的项目文件通过「保存」或「另存为」更新。

| 内容 | Windows 路径 |
| --- | --- |
| 项目文件 | 在「保存」或「另存为」中选择的位置 |
| 自动存档 | `%APPDATA%\studio.irclog.desktop\workspace-v1.json` |
| 自动存档备份 | `%APPDATA%\studio.irclog.desktop\workspace-v1.json.bak` |
| 项目文件备份 | 项目文件旁的同名 `.bak` 文件 |
| 模板目录 | `%APPDATA%\studio.irclog.desktop\templates\` |

## 模板和导出

1. 点击「打开模板目录」。
2. 用文本编辑器修改 `classic.json`，或复制一份后重命名。
3. 保存模板文件。
4. 点击「重新加载模板」。
5. 在「日志模板」中选择模板。

首次启动时，应用会将 Classic IRC 和 Minimal 模板复制到模板目录。模板文件格式见[模板变量说明](docs/templates.md)。

点击「导出」，选择当前频道或所有频道，再选择文件格式。TXT 导出可以选择模板和时间戳。导出所有频道到 TXT 时，应用在同一个文件中加入频道分隔行。JSON 导出保留结构化数据。导出当前频道到 JSON 时，项目包含该频道和项目用户档案。

## 源码

- `src/model.ts` 定义事件、档案和项目结构，并推导频道成员。
- `src/render.ts` 提供模板加载、日志格式化和 TXT 导出。
- `src/components/` 包含日志预览、事件编辑器、用户档案库和导出窗口。
- `src/desktop.ts` 和 `src/useWorkspace.ts` 连接桌面命令、自动存档和恢复。
- `src-tauri/` 包含窗口配置、本地文件命令和安全替换写入。

## 验证

```powershell
pnpm check
pnpm test
pnpm build
pnpm test:ui
cargo test --manifest-path src-tauri/Cargo.toml
```

界面测试使用本机 Edge 和临时文件。测试专用 IPC 接口替代原生对话框和 Rust 文件命令。若使用 Chrome，先设置 `$env:IRC_STUDIO_BROWSER = 'chrome'`。

2026-11-12 验证结果为类型检查通过、10 项单元测试通过、前端构建通过、Edge 界面验收通过。Vite 构建有 Zod 注释警告。Rust 单元测试和 Windows 原生界面仍待验证。

## 当前限制

- 自动存档恢复最后使用的工作区。单独保留项目时，请保存到项目文件。
- 模板格式包含文本变量和时间标记。颜色由应用样式定义。
- 事件通过追加录入，历史事件可原位编辑或删除。
- Windows 原生构建和文件替换测试需要 Rust、Cargo 和 MSVC。当前开发环境缺少这些工具，尚未生成可执行文件或安装程序。
