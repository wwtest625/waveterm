// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { cn } from "@/util/util";
import { useAtomValue, useSetAtom } from "jotai";
import { memo, useCallback, useMemo } from "react";

interface SettingItemProps {
    label: string;
    description?: string;
    children: React.ReactNode;
}

const SettingItem = memo(({ label, description, children }: SettingItemProps) => {
    return (
        <div className="flex flex-col gap-1.5 py-3 px-4 border-b border-zinc-700/50 hover:bg-zinc-800/30 transition-colors">
            <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col">
                    <span className="text-sm font-medium text-zinc-200">{label}</span>
                    {description && <span className="text-xs text-zinc-500 mt-0.5">{description}</span>}
                </div>
                <div className="shrink-0">{children}</div>
            </div>
        </div>
    );
});
SettingItem.displayName = "SettingItem";

interface ToggleSwitchProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabled?: boolean;
}

const ToggleSwitch = memo(({ checked, onChange, disabled }: ToggleSwitchProps) => {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className={cn(
                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-accent-500 focus:ring-offset-2 focus:ring-offset-zinc-900",
                checked ? "bg-accent-600" : "bg-zinc-600",
                disabled && "opacity-50 cursor-not-allowed"
            )}
        >
            <span
                className={cn(
                    "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out",
                    checked ? "translate-x-4" : "translate-x-0"
                )}
            />
        </button>
    );
});
ToggleSwitch.displayName = "ToggleSwitch";

interface TextInputProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
    type?: "text" | "number";
}

const TextInput = memo(({ value, onChange, placeholder, disabled, type = "text" }: TextInputProps) => {
    return (
        <input
            type={type}
            value={value}
            onChange={(e) => onChange(type === "number" ? e.target.value : e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            className={cn(
                "w-40 px-3 py-1.5 bg-zinc-800 border border-zinc-600 rounded text-sm text-zinc-200 focus:outline-none focus:border-accent-500",
                disabled && "opacity-50 cursor-not-allowed"
            )}
        />
    );
});
TextInput.displayName = "TextInput";

interface SelectInputProps {
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
    disabled?: boolean;
}

const SelectInput = memo(({ value, onChange, options, disabled }: SelectInputProps) => {
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className={cn(
                "w-40 px-3 py-1.5 bg-zinc-800 border border-zinc-600 rounded text-sm text-zinc-200 focus:outline-none focus:border-accent-500 appearance-none cursor-pointer",
                disabled && "opacity-50 cursor-not-allowed"
            )}
        >
            {options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                    {opt.label}
                </option>
            ))}
        </select>
    );
});
SelectInput.displayName = "SelectInput";

interface SettingSectionProps {
    title: string;
    icon: string;
    children: React.ReactNode;
    defaultExpanded?: boolean;
}

const SettingSection = memo(({ title, icon, children, defaultExpanded = true }: SettingSectionProps) => {
    return (
        <div className="border border-zinc-700/50 rounded-lg overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 bg-zinc-800/50 border-b border-zinc-700/50">
                <i className={`fa-sharp fa-solid ${icon} text-zinc-400`} />
                <span className="font-semibold text-zinc-200">{title}</span>
            </div>
            <div>{children}</div>
        </div>
    );
});
SettingSection.displayName = "SettingSection";

type SettingsData = Record<string, any>;

interface SettingsContentProps {
    model: WaveConfigViewModel;
}

export const SettingsVisualContent = memo(({ model }: SettingsContentProps) => {
    const fileContent = useAtomValue(model.fileContentAtom);
    const setFileContent = useSetAtom(model.fileContentAtom);

    const settings: SettingsData = useMemo(() => {
        try {
            return JSON.parse(fileContent || "{}");
        } catch {
            return {};
        }
    }, [fileContent]);

    const updateSetting = useCallback(
        (key: string, value: any) => {
            const newSettings = { ...settings, [key]: value };
            setFileContent(JSON.stringify(newSettings, null, 2));
            model.markAsEdited();
        },
        [settings, setFileContent, model]
    );

    return (
        <div className="h-full overflow-y-auto bg-zinc-900">
            <div className="max-w-3xl mx-auto py-4 space-y-4">
                <SettingSection title="应用" icon="fa-window-maximize">
                    <SettingItem
                        label="默认新建块"
                        description="创建新块时的默认块类型"
                    >
                        <SelectInput
                            value={settings["app:defaultnewblock"] || "term"}
                            onChange={(v) => updateSetting("app:defaultnewblock", v)}
                            options={[
                                { value: "term", label: "终端" },
                                { value: "launcher", label: "启动器" },
                            ]}
                        />
                    </SettingItem>
                    <SettingItem
                        label="退出确认"
                        description="关闭 Wave 时显示确认对话框"
                    >
                        <ToggleSwitch
                            checked={settings["app:confirmquit"] !== false}
                            onChange={(v) => updateSetting("app:confirmquit", v)}
                        />
                    </SettingItem>
                    <SettingItem
                        label="隐藏 AI 按钮"
                        description="在标签栏中隐藏 AI 按钮"
                    >
                        <ToggleSwitch
                            checked={settings["app:hideaibutton"] === true}
                            onChange={(v) => updateSetting("app:hideaibutton", v)}
                        />
                    </SettingItem>
                    <SettingItem
                        label="显示块编号"
                        description="显示 Ctrl+Shift 块编号覆盖层"
                    >
                        <ToggleSwitch
                            checked={settings["app:showoverlayblocknums"] !== false}
                            onChange={(v) => updateSetting("app:showoverlayblocknums", v)}
                        />
                    </SettingItem>
                    <SettingItem
                        label="禁用 Ctrl+Shift 方向键"
                        description="禁用 Ctrl+Shift 块导航快捷键"
                    >
                        <ToggleSwitch
                            checked={settings["app:disablectrlshiftarrows"] === true}
                            onChange={(v) => updateSetting("app:disablectrlshiftarrows", v)}
                        />
                    </SettingItem>
                    <SettingItem
                        label="禁用 Ctrl+Shift 显示"
                        description="禁用 Ctrl+Shift 可视化指示器"
                    >
                        <ToggleSwitch
                            checked={settings["app:disablectrlshiftdisplay"] === true}
                            onChange={(v) => updateSetting("app:disablectrlshiftdisplay", v)}
                        />
                    </SettingItem>
                    <SettingItem
                        label="焦点跟随光标"
                        description="块焦点跟随光标移动"
                    >
                        <SelectInput
                            value={settings["app:focusfollowscursor"] || "off"}
                            onChange={(v) => updateSetting("app:focusfollowscursor", v)}
                            options={[
                                { value: "off", label: "关闭" },
                                { value: "on", label: "开启" },
                                { value: "term", label: "仅终端" },
                            ]}
                        />
                    </SettingItem>
                </SettingSection>

                <SettingSection title="终端" icon="fa-terminal">
                    <SettingItem
                        label="字体大小"
                        description="终端字体大小（像素）"
                    >
                        <TextInput
                            type="number"
                            value={settings["term:fontsize"]?.toString() || ""}
                            onChange={(v) => updateSetting("term:fontsize", parseFloat(v) || undefined)}
                            placeholder="14"
                        />
                    </SettingItem>
                    <SettingItem
                        label="字体"
                        description="终端字体系列"
                    >
                        <SelectInput
                            value={settings["term:fontfamily"] || ""}
                            onChange={(v) => updateSetting("term:fontfamily", v || undefined)}
                            options={[
                                { value: "", label: "默认" },
                                { value: "Monaco", label: "Monaco" },
                                { value: "Menlo", label: "Menlo" },
                                { value: "Consolas", label: "Consolas" },
                                { value: "Courier New", label: "Courier New" },
                                { value: "Fira Code", label: "Fira Code" },
                                { value: "JetBrains Mono", label: "JetBrains Mono" },
                                { value: "Source Code Pro", label: "Source Code Pro" },
                                { value: "Hack", label: "Hack" },
                                { value: "Ubuntu Mono", label: "Ubuntu Mono" },
                            ]}
                        />
                    </SettingItem>
                    <SettingItem
                        label="主题"
                        description="默认终端主题"
                    >
                        <SelectInput
                            value={settings["term:theme"] || "default-dark"}
                            onChange={(v) => updateSetting("term:theme", v)}
                            options={[
                                { value: "default-dark", label: "Default Dark" },
                                { value: "onedarkpro", label: "One Dark Pro" },
                                { value: "dracula", label: "Dracula" },
                                { value: "monokai", label: "Monokai" },
                                { value: "campbell", label: "Campbell" },
                                { value: "warmyellow", label: "Warm Yellow" },
                                { value: "rosepine", label: "Rose Pine" },
                            ]}
                        />
                    </SettingItem>
                    <SettingItem
                        label="滚动回退"
                        description="终端滚动缓冲区大小（最大 10000）"
                    >
                        <TextInput
                            type="number"
                            value={settings["term:scrollback"]?.toString() || ""}
                            onChange={(v) => updateSetting("term:scrollback", parseInt(v) || undefined)}
                            placeholder="1000"
                        />
                    </SettingItem>
                    <SettingItem
                        label="选中即复制"
                        description="自动将选中的内容复制到剪贴板"
                    >
                        <ToggleSwitch
                            checked={settings["term:copyonselect"] !== false}
                            onChange={(v) => updateSetting("term:copyonselect", v)}
                        />
                    </SettingItem>
                    <SettingItem
                        label="光标样式"
                        description="终端光标样式"
                    >
                        <SelectInput
                            value={settings["term:cursor"] || "block"}
                            onChange={(v) => updateSetting("term:cursor", v)}
                            options={[
                                { value: "block", label: "方块" },
                                { value: "underline", label: "下划线" },
                                { value: "bar", label: "竖线" },
                            ]}
                        />
                    </SettingItem>
                    <SettingItem
                        label="光标闪烁"
                        description="启用光标闪烁"
                    >
                        <ToggleSwitch
                            checked={settings["term:cursorblink"] === true}
                            onChange={(v) => updateSetting("term:cursorblink", v)}
                        />
                    </SettingItem>
                    <SettingItem
                        label="铃声声音"
                        description="终端响铃时播放系统提示音"
                    >
                        <ToggleSwitch
                            checked={settings["term:bellsound"] === true}
                            onChange={(v) => updateSetting("term:bellsound", v)}
                        />
                    </SettingItem>
                    <SettingItem
                        label="铃声指示器"
                        description="收到响铃时在标签上显示可视化指示器"
                    >
                        <ToggleSwitch
                            checked={settings["term:bellindicator"] === true}
                            onChange={(v) => updateSetting("term:bellindicator", v)}
                        />
                    </SettingItem>
                    <SettingItem
                        label="持久会话"
                        description="使远程会话在断开后保持持久"
                    >
                        <ToggleSwitch
                            checked={settings["term:durable"] === true}
                            onChange={(v) => updateSetting("term:durable", v)}
                        />
                    </SettingItem>
                    <SettingItem
                        label="透明度"
                        description="背景透明度（0-1）"
                    >
                        <TextInput
                            type="number"
                            value={settings["term:transparency"]?.toString() || ""}
                            onChange={(v) => updateSetting("term:transparency", parseFloat(v) || undefined)}
                            placeholder="0.5"
                        />
                    </SettingItem>
                    <SettingItem
                        label="允许括号粘贴"
                        description="启用括号粘贴模式"
                    >
                        <ToggleSwitch
                            checked={settings["term:allowbracketedpaste"] === true}
                            onChange={(v) => updateSetting("term:allowbracketedpaste", v)}
                        />
                    </SettingItem>
                    <SettingItem
                        label="Shift+Enter 换行"
                        description="Shift+Enter 发送转义序列+换行"
                    >
                        <ToggleSwitch
                            checked={settings["term:shiftenternewline"] === true}
                            onChange={(v) => updateSetting("term:shiftenternewline", v)}
                        />
                    </SettingItem>
                </SettingSection>

                <SettingSection title="编辑器" icon="fa-code">
                    <SettingItem
                        label="字体大小"
                        description="编辑器字体大小（像素）"
                    >
                        <TextInput
                            type="number"
                            value={settings["editor:fontsize"]?.toString() || ""}
                            onChange={(v) => updateSetting("editor:fontsize", parseFloat(v) || undefined)}
                            placeholder="12"
                        />
                    </SettingItem>
                    <SettingItem
                        label="小地图"
                        description="显示编辑器小地图"
                    >
                        <ToggleSwitch
                            checked={settings["editor:minimapenabled"] !== false}
                            onChange={(v) => updateSetting("editor:minimapenabled", v)}
                        />
                    </SettingItem>
                    <SettingItem
                        label="粘性滚动"
                        description="启用粘性滚动（固定当前上下文标题）"
                    >
                        <ToggleSwitch
                            checked={settings["editor:stickyscrollenabled"] === true}
                            onChange={(v) => updateSetting("editor:stickyscrollenabled", v)}
                        />
                    </SettingItem>
                    <SettingItem
                        label="自动换行"
                        description="在编辑器中启用自动换行"
                    >
                        <ToggleSwitch
                            checked={settings["editor:wordwrap"] === true}
                            onChange={(v) => updateSetting("editor:wordwrap", v)}
                        />
                    </SettingItem>
                    <SettingItem
                        label="内联差异"
                        description="以内联方式显示差异而非并排显示"
                    >
                        <ToggleSwitch
                            checked={settings["editor:inlinediff"] === true}
                            onChange={(v) => updateSetting("editor:inlinediff", v)}
                        />
                    </SettingItem>
                </SettingSection>

                <SettingSection title="窗口" icon="fa-square">
                    <SettingItem
                        label="原生标题栏"
                        description="使用系统原生标题栏（Windows/Linux）"
                    >
                        <ToggleSwitch
                            checked={settings["window:nativetitlebar"] !== false}
                            onChange={(v) => updateSetting("window:nativetitlebar", v)}
                        />
                    </SettingItem>
                    <SettingItem
                        label="显示菜单栏"
                        description="显示系统原生菜单栏（Windows/Linux）"
                    >
                        <ToggleSwitch
                            checked={settings["window:showmenubar"] === true}
                            onChange={(v) => updateSetting("window:showmenubar", v)}
                        />
                    </SettingItem>
                    <SettingItem
                        label="启动时全屏"
                        description="启动时进入全屏模式"
                    >
                        <ToggleSwitch
                            checked={settings["window:fullscreenonlaunch"] === true}
                            onChange={(v) => updateSetting("window:fullscreenonlaunch", v)}
                        />
                    </SettingItem>
                    <SettingItem
                        label="保存上次窗口"
                        description="重启应用时重新打开上次窗口"
                    >
                        <ToggleSwitch
                            checked={settings["window:savelastwindow"] !== false}
                            onChange={(v) => updateSetting("window:savelastwindow", v)}
                        />
                    </SettingItem>
                    <SettingItem
                        label="关闭确认"
                        description="关闭窗口前确认"
                    >
                        <ToggleSwitch
                            checked={settings["window:confirmclose"] !== false}
                            onChange={(v) => updateSetting("window:confirmclose", v)}
                        />
                    </SettingItem>
                    <SettingItem
                        label="块间距"
                        description="块之间的间距（像素）"
                    >
                        <TextInput
                            type="number"
                            value={settings["window:tilegapsize"]?.toString() || ""}
                            onChange={(v) => updateSetting("window:tilegapsize", parseInt(v) || undefined)}
                            placeholder="3"
                        />
                    </SettingItem>
                    <SettingItem
                        label="标签缓存数量"
                        description="要缓存的标签数量"
                    >
                        <TextInput
                            type="number"
                            value={settings["window:maxtabcachesize"]?.toString() || ""}
                            onChange={(v) => updateSetting("window:maxtabcachesize", parseInt(v) || undefined)}
                            placeholder="10"
                        />
                    </SettingItem>
                    <SettingItem
                        label="放大块透明度"
                        description="放大块的透明度（0-1）"
                    >
                        <TextInput
                            type="number"
                            value={settings["window:magnifiedblockopacity"]?.toString() || ""}
                            onChange={(v) => updateSetting("window:magnifiedblockopacity", parseFloat(v) || undefined)}
                            placeholder="0.6"
                        />
                    </SettingItem>
                    <SettingItem
                        label="放大块大小"
                        description="放大块占父容器的百分比（0-1）"
                    >
                        <TextInput
                            type="number"
                            value={settings["window:magnifiedblocksize"]?.toString() || ""}
                            onChange={(v) => updateSetting("window:magnifiedblocksize", parseFloat(v) || undefined)}
                            placeholder="0.9"
                        />
                    </SettingItem>
                    <SettingItem
                        label="减少动画"
                        description="禁用大部分动画效果"
                    >
                        <ToggleSwitch
                            checked={settings["window:reducedmotion"] === true}
                            onChange={(v) => updateSetting("window:reducedmotion", v)}
                        />
                    </SettingItem>
                    <SettingItem
                        label="窗口透明"
                        description="启用窗口透明度（macOS/Windows）"
                    >
                        <ToggleSwitch
                            checked={settings["window:transparent"] === true}
                            onChange={(v) => updateSetting("window:transparent", v)}
                        />
                    </SettingItem>
                    <SettingItem
                        label="窗口模糊"
                        description="启用窗口背景模糊（macOS/Windows）"
                    >
                        <ToggleSwitch
                            checked={settings["window:blur"] === true}
                            onChange={(v) => updateSetting("window:blur", v)}
                        />
                    </SettingItem>
                </SettingSection>

                <SettingSection title="AI" icon="fa-robot">
                    <SettingItem
                        label="默认模型"
                        description="默认使用的 AI 模型"
                    >
                        <TextInput
                            value={settings["ai:model"] || ""}
                            onChange={(v) => updateSetting("ai:model", v || undefined)}
                            placeholder="gpt-5-mini"
                        />
                    </SettingItem>
                    <SettingItem
                        label="最大令牌数"
                        description="AI 响应的最大令牌数"
                    >
                        <TextInput
                            type="number"
                            value={settings["ai:maxtokens"]?.toString() || ""}
                            onChange={(v) => updateSetting("ai:maxtokens", parseInt(v) || undefined)}
                            placeholder="4000"
                        />
                    </SettingItem>
                    <SettingItem
                        label="超时时间 (毫秒)"
                        description="AI API 超时时间（毫秒）"
                    >
                        <TextInput
                            type="number"
                            value={settings["ai:timeoutms"]?.toString() || ""}
                            onChange={(v) => updateSetting("ai:timeoutms", parseInt(v) || undefined)}
                            placeholder="60000"
                        />
                    </SettingItem>
                    <SettingItem
                        label="显示云端模式"
                        description="在 AI 面板中显示 Wave AI 云端模式"
                    >
                        <ToggleSwitch
                            checked={settings["waveai:showcloudmodes"] !== false}
                            onChange={(v) => updateSetting("waveai:showcloudmodes", v)}
                        />
                    </SettingItem>
                    <SettingItem
                        label="默认模式"
                        description="默认 AI 模式"
                    >
                        <SelectInput
                            value={settings["waveai:defaultmode"] || "waveai@balanced"}
                            onChange={(v) => updateSetting("waveai:defaultmode", v)}
                            options={[
                                { value: "waveai@quick", label: "Quick (快速)" },
                                { value: "waveai@balanced", label: "Balanced (均衡)" },
                                { value: "waveai@deep", label: "Deep (深度)" },
                            ]}
                        />
                    </SettingItem>
                    <SettingItem
                        label="跳过命令审批"
                        description="AI 生成的常规命令（查询、创建、编辑、写入等）无需手动审批即可执行，危险命令仍会被阻止"
                    >
                        <ToggleSwitch
                            checked={settings["waveai:skipapproval"] === true}
                            onChange={(v) => updateSetting("waveai:skipapproval", v)}
                        />
                    </SettingItem>
                </SettingSection>

                <SettingSection title="网页" icon="fa-globe">
                    <SettingItem
                        label="内部打开链接"
                        description="在 Wave 内部而非外部浏览器中打开网页链接"
                    >
                        <ToggleSwitch
                            checked={settings["web:openlinksinternally"] !== false}
                            onChange={(v) => updateSetting("web:openlinksinternally", v)}
                        />
                    </SettingItem>
                    <SettingItem
                        label="默认网址"
                        description="网页小组件的默认首页"
                    >
                        <TextInput
                            value={settings["web:defaulturl"] || ""}
                            onChange={(v) => updateSetting("web:defaulturl", v || undefined)}
                            placeholder="https://github.com/wavetermdev/waveterm"
                        />
                    </SettingItem>
                    <SettingItem
                        label="默认搜索"
                        description="搜索模板网址"
                    >
                        <TextInput
                            value={settings["web:defaultsearch"] || ""}
                            onChange={(v) => updateSetting("web:defaultsearch", v || undefined)}
                            placeholder="https://www.google.com/search?q={query}"
                        />
                    </SettingItem>
                </SettingSection>

                <SettingSection title="自动更新" icon="fa-download">
                    <SettingItem
                        label="启用"
                        description="启用自动检查更新"
                    >
                        <ToggleSwitch
                            checked={settings["autoupdate:enabled"] !== false}
                            onChange={(v) => updateSetting("autoupdate:enabled", v)}
                        />
                    </SettingItem>
                    <SettingItem
                        label="退出时安装"
                        description="退出时自动安装更新"
                    >
                        <ToggleSwitch
                            checked={settings["autoupdate:installonquit"] !== false}
                            onChange={(v) => updateSetting("autoupdate:installonquit", v)}
                        />
                    </SettingItem>
                    <SettingItem
                        label="检查间隔（毫秒）"
                        description="检查更新的时间间隔"
                    >
                        <TextInput
                            type="number"
                            value={settings["autoupdate:intervalms"]?.toString() || ""}
                            onChange={(v) => updateSetting("autoupdate:intervalms", parseInt(v) || undefined)}
                            placeholder="3600000"
                        />
                    </SettingItem>
                    <SettingItem
                        label="更新通道"
                        description="自动更新通道"
                    >
                        <SelectInput
                            value={settings["autoupdate:channel"] || "latest"}
                            onChange={(v) => updateSetting("autoupdate:channel", v)}
                            options={[
                                { value: "latest", label: "最新（稳定版）" },
                                { value: "beta", label: "测试版" },
                            ]}
                        />
                    </SettingItem>
                </SettingSection>

                <SettingSection title="连接" icon="fa-network-wired">
                    <SettingItem
                        label="安装前询问"
                        description="在新机器上安装 wsh 前询问"
                    >
                        <ToggleSwitch
                            checked={settings["conn:askbeforewshinstall"] !== false}
                            onChange={(v) => updateSetting("conn:askbeforewshinstall", v)}
                        />
                    </SettingItem>
                    <SettingItem
                        label="启用 WSH"
                        description="启用 Wave SSH 助手"
                    >
                        <ToggleSwitch
                            checked={settings["conn:wshenabled"] !== false}
                            onChange={(v) => updateSetting("conn:wshenabled", v)}
                        />
                    </SettingItem>
                    <SettingItem
                        label="本地主机显示名称"
                        description="本地主机在界面中的显示名称"
                    >
                        <TextInput
                            value={settings["conn:localhostdisplayname"] || ""}
                            onChange={(v) => updateSetting("conn:localhostdisplayname", v || undefined)}
                            placeholder="我的电脑"
                        />
                    </SettingItem>
                </SettingSection>

                <SettingSection title="标签页" icon="fa-folder">
                    <SettingItem
                        label="标签预设"
                        description="新标签页的默认背景预设"
                    >
                        <SelectInput
                            value={settings["tab:preset"] || "bg@default"}
                            onChange={(v) => updateSetting("tab:preset", v)}
                            options={[
                                { value: "bg@default", label: "Default (默认)" },
                                { value: "bg@rainbow", label: "Rainbow (彩虹)" },
                                { value: "bg@green", label: "Green (绿色)" },
                                { value: "bg@blue", label: "Blue (蓝色)" },
                                { value: "bg@red", label: "Red (红色)" },
                                { value: "bg@ocean-depths", label: "Ocean Depths" },
                                { value: "bg@aqua-horizon", label: "Aqua Horizon" },
                                { value: "bg@sunset", label: "Sunset (日落)" },
                                { value: "bg@enchantedforest", label: "Enchanted Forest" },
                                { value: "bg@twilight-mist", label: "Twilight Mist" },
                                { value: "bg@duskhorizon", label: "Dusk Horizon" },
                                { value: "bg@tropical-radiance", label: "Tropical Radiance" },
                                { value: "bg@twilight-ember", label: "Twilight Ember" },
                                { value: "bg@cosmic-tide", label: "Cosmic Tide" },
                            ]}
                        />
                    </SettingItem>
                    <SettingItem
                        label="关闭确认"
                        description="关闭标签页前确认"
                    >
                        <ToggleSwitch
                            checked={settings["tab:confirmclose"] === true}
                            onChange={(v) => updateSetting("tab:confirmclose", v)}
                        />
                    </SettingItem>
                </SettingSection>
            </div>
        </div>
    );
});

SettingsVisualContent.displayName = "SettingsVisualContent";
