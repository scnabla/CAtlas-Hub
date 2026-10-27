# Linux 开发

日常开发使用 Linux，扩展同时支持 Windows 和 Linux。两端均需通过静态检查、单元测试、打包工具测试，以及最低支持版本和稳定版的扩展宿主测试。

## 环境

- Node.js 24、npm、Git；`.nvmrc` 固定 Node.js 主版本。
- VS Code 1.88.0 或更新版本，用于 F5 调试；自动化测试会下载独立实例。
- `rg` 用于 TODO 本地搜索；缺失时扩展可使用其他搜索方式。
- `gh` 用于已授权的 GitHub 操作，从系统 `PATH` 查找。

Ubuntu 桌面环境可以直接运行集成测试。没有桌面显示服务时需要 Xvfb。Ubuntu 24.04 的测试依赖可按需安装：

```bash
sudo apt-get update
sudo apt-get install xvfb libgtk-3-0t64 libnss3 libgbm1 libasound2t64 libxss1 fonts-liberation
```

## 安装与检查

在当前项目目录执行命令。两个子项目分别安装依赖；切换操作系统后必须重新安装，不能复用其他平台的 `node_modules`。

```bash
# 使用 nvm 时先执行 nvm use
node --version
npm ci --ignore-scripts
npm run check
npm run test:unit
npm run test:release-tools
```

`npm ci` 按锁文件重建依赖，包括 Linux 对应的原生模块；不执行依赖包的安装脚本。文本文件使用 UTF-8、LF 换行，路径大小写必须与磁盘一致。

## 调试与集成测试

在 VS Code 中打开当前子项目目录，按 F5 选择“运行项目管家扩展”。编译任务会先生成 `dist/`。

```bash
npm run watch

# 在桌面终端验证最低支持版本
PROJECT_BUTLER_TEST_VSCODE_VERSION=1.88.0 npm run test:integration

# 使用本机已安装的 Linux VS Code，不下载运行时
# 路径指向安装目录中的 code 可执行文件，不是 /usr/bin/code 启动脚本
PROJECT_BUTLER_TEST_VSCODE_EXECUTABLE=/usr/share/code/code npm run test:integration

# 下载并验证当前稳定版
npm run test:integration

# 无桌面的终端或 CI
xvfb-run -a npm run test:integration
```

集成测试先生成新候选 VSIX，再依次运行 TODO 内存回归、源码扩展宿主和安装态测试。打包脚本自动传入准确文件路径、版本、扩展 ID 和 SHA-256；直接执行 `npx vscode-test` 不会准备这些参数。

指定本机可执行文件时，测试使用该文件对应的版本，`PROJECT_BUTLER_TEST_VSCODE_VERSION` 不再选择运行时。候选扩展安装到新建的隔离目录，不修改日常扩展安装。发布前的最低版本验证使用下载流程。

测试下载和用户数据位于被 Git 忽略的 `.vscode-test/`，与日常 VS Code 用户目录隔离。该目录不跨操作系统复用。测试工具仅对隔离的 Electron 测试进程添加 `--no-sandbox`，不修改系统安全配置。

CI 在 Ubuntu 24.04 和 Windows Server 2022、Node.js 24 上分别执行静态检查、单元测试、打包工具测试，并验证 VS Code 1.88.0 和稳定版。Linux 宿主测试使用 Xvfb；Windows 直接运行。

Windows 验证使用本地独立工作目录，重新执行 `npm ci --ignore-scripts`，不复制 Linux 的 `node_modules` 或运行时缓存。Git 快速搜索测试要求源码目录是当前测试用户可访问的 Git 仓库；通过复制源码准备环境时，在临时副本执行 `git init`。在 PowerShell 中设置最低版本并运行：

```powershell
$env:PROJECT_BUTLER_TEST_VSCODE_VERSION = '1.88.0'
npm run test:integration

$env:PROJECT_BUTLER_TEST_VSCODE_VERSION = 'stable'
npm run test:integration
```

## 打包

```bash
# 预览测试包；已有文件存在时自动递增文件名
npm run package:vsix

# 正式包
npm run package:vsix -- --stage stable
```

产物写入 `releases/`。终端输出准确路径和 SHA-256；历史包不覆盖。VSIX 不包含源码、测试、开发工具、下载缓存或已有发布包。安装态测试检查本轮生成的包。

## 图标工具

```bash
npm run icons:check
npm run icons:generate

# 导出到新路径，保留正式 PNG
npm run icons:export -- --out /tmp/catlas-hub.png

# 明确覆盖商店 PNG
npm run icons:export -- --replace
```

商店图标由 `scripts/export-marketplace-icon.mjs` 从 `media/catlas-hub.svg` 渲染为 256×256 PNG。Linux 使用系统字体；安装 `fonts-liberation` 可提供 Arial 的替代字体。现有正式 PNG 不会在安装依赖、检查或打包时被重新生成。

## TODO 扫描与缓存

本地 Git 项目优先使用 `git grep` 定位个人标记，非 Git 项目尝试 `rg`；工具不可用、远程或虚拟工作区使用 VS Code API 扫描。未跟踪文件与未保存文档单独补充。扫描合并 `files.exclude`、`search.exclude` 和常见依赖、构建目录规则；带 `when` 的条件式排除规则不作为无条件排除处理。

候选文件经过注释解析后生成结果，零结果文件不加入结果索引。磁盘读取使用 BOM 和 `files.encoding`，对 GBK、ANSI 等旧源码提供兼容回退并在输出频道记录。单文件上限为 2 MiB，个人标记和项目已有标记分别保留 5,000 条结果配额。

启动时读取工作区缓存并检查文件变化。打开文档的编辑优先更新内存索引，后台文件变化分批处理；同一 URI 的磁盘和编辑器结果去重。缓存保存在工作区扩展存储，包含文件 URI、时间、大小、标记描述和位置，不包含整份源码。缓存无效、过期或扫描配置变化时完整更新；失败或取消不以不完整结果覆盖有效缓存。

内存扫描基准命令：

```bash
npm run benchmark:todo
```

## 配置存储与视图

默认用户目录中的 `personal-data.dat.location` 记录当前数据文件位置。个人数据文件保存偏好、集合和关联，工作区状态保存活动状态与恢复记录。VS Code 内置 AI、原生视图与快捷键设置由 VS Code 自身保存。

集合功能包括 `features.tabs.autoOrganize` 和 `features.symbolOutline.mode`，默认值分别为 `false` 和 `both`。工作区显式设置优先于集合覆盖和个人默认值；大纲模式快捷选择与配置视图共用配置写入服务。

标签整理等待活动标签切换完成后再调用 VS Code 移动命令。原生视图按当前版本注册的命令隐藏或恢复，缺少命令时提示手动操作；恢复失败时保留恢复记录。

活动栏图标在扩展清单中声明。树视图与增强大纲按个人图标风格刷新，不修改工作台 CSS。标签装饰可调整文字或图标前景，不能单独修改标签的完整背景或加粗文字。

## 用户文档与发布检查

`README.md` 用于扩展详情页，包含功能介绍、安装使用、配置操作及必要限制。开发环境、实现说明和测试命令维护在 `DEVELOPMENT.md`；内部测试清单与验收记录维护在内部仓库的 `doc/`。开发文档与内部记录由 `.vscodeignore` 排除，不随 VSIX 分发。

修改 README 后逐段检查其是否适合扩展使用者阅读，核对命令名称、功能限制和下载链接。已发布安装包中的 README 不会随仓库文件修改而更新；更新扩展详情需按发布流程生成并发布新版本。
