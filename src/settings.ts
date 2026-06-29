import { App, PluginSettingTab, Setting } from "obsidian";
import type PdfEditorPlugin from "./main";

export interface PdfEditorSettings {
  defaultScale: number;
  enableAnnotations: boolean;
  enableTextEditing: boolean;
  sidebarVisible: boolean;
  highlightColor: string;
  penColor: string;
  penSize: number;
  autoSave: boolean;
  autoSaveInterval: number;
  // Drawing tablet settings
  enablePressureSensitivity: boolean;
  pressureMinWidth: number;
  pressureMaxWidth: number;
  enablePalmRejection: boolean;
  enableLineSmoothing: boolean;
  smoothingFactor: number;
  penButton1Tool: string;
  penButton2Tool: string;
  eraserSize: number;
}

export const DEFAULT_SETTINGS: PdfEditorSettings = {
  defaultScale: 1.0,
  enableAnnotations: true,
  enableTextEditing: false,
  sidebarVisible: true,
  highlightColor: "#FFFF00",
  penColor: "#FF0000",
  penSize: 2,
  autoSave: true,
  autoSaveInterval: 5000,
  // Drawing tablet defaults
  enablePressureSensitivity: true,
  pressureMinWidth: 1,
  pressureMaxWidth: 8,
  enablePalmRejection: true,
  enableLineSmoothing: true,
  smoothingFactor: 0.5,
  penButton1Tool: "eraser",
  penButton2Tool: "highlight",
  eraserSize: 20,
};

export class PdfEditorSettingTab extends PluginSettingTab {
  plugin: PdfEditorPlugin;

  constructor(app: App, plugin: PdfEditorPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "PDF Editor 设置" });

    // Default Scale
    new Setting(containerEl)
      .setName("默认缩放比例")
      .setDesc("打开 PDF 时的默认缩放比例")
      .addSlider((slider) =>
        slider
          .setLimits(0.5, 3.0, 0.1)
          .setValue(this.plugin.settings.defaultScale)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.defaultScale = value;
            await this.plugin.saveSettings();
          })
      );

    // Enable Annotations
    new Setting(containerEl)
      .setName("启用注释")
      .setDesc("允许在 PDF 中添加注释")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableAnnotations)
          .onChange(async (value) => {
            this.plugin.settings.enableAnnotations = value;
            await this.plugin.saveSettings();
          })
      );

    // Enable Text Editing
    new Setting(containerEl)
      .setName("启用文本编辑")
      .setDesc("允许编辑 PDF 中的文本（实验性功能）")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableTextEditing)
          .onChange(async (value) => {
            this.plugin.settings.enableTextEditing = value;
            await this.plugin.saveSettings();
          })
      );

    // Sidebar Visible
    new Setting(containerEl)
      .setName("显示侧边栏")
      .setDesc("打开 PDF 时默认显示侧边栏")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.sidebarVisible)
          .onChange(async (value) => {
            this.plugin.settings.sidebarVisible = value;
            await this.plugin.saveSettings();
          })
      );

    // Highlight Color
    new Setting(containerEl)
      .setName("高亮颜色")
      .setDesc("高亮注释的默认颜色")
      .addColorPicker((picker) =>
        picker
          .setValue(this.plugin.settings.highlightColor)
          .onChange(async (value) => {
            this.plugin.settings.highlightColor = value;
            await this.plugin.saveSettings();
          })
      );

    // Pen Color
    new Setting(containerEl)
      .setName("画笔颜色")
      .setDesc("画笔工具的默认颜色")
      .addColorPicker((picker) =>
        picker
          .setValue(this.plugin.settings.penColor)
          .onChange(async (value) => {
            this.plugin.settings.penColor = value;
            await this.plugin.saveSettings();
          })
      );

    // Pen Size
    new Setting(containerEl)
      .setName("画笔大小")
      .setDesc("画笔工具的默认大小")
      .addSlider((slider) =>
        slider
          .setLimits(1, 10, 1)
          .setValue(this.plugin.settings.penSize)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.penSize = value;
            await this.plugin.saveSettings();
          })
      );

    // Eraser Size
    new Setting(containerEl)
      .setName("橡皮擦大小")
      .setDesc("橡皮擦工具的大小")
      .addSlider((slider) =>
        slider
          .setLimits(5, 50, 1)
          .setValue(this.plugin.settings.eraserSize)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.eraserSize = value;
            await this.plugin.saveSettings();
          })
      );

    // Auto Save
    new Setting(containerEl)
      .setName("自动保存")
      .setDesc("自动保存对 PDF 的修改")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoSave)
          .onChange(async (value) => {
            this.plugin.settings.autoSave = value;
            await this.plugin.saveSettings();
          })
      );

    // Auto Save Interval
    new Setting(containerEl)
      .setName("自动保存间隔")
      .setDesc("自动保存的时间间隔（毫秒）")
      .addText((text) =>
        text
          .setPlaceholder("5000")
          .setValue(String(this.plugin.settings.autoSaveInterval))
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num > 0) {
              this.plugin.settings.autoSaveInterval = num;
              await this.plugin.saveSettings();
            }
          })
      );

    // Drawing tablet settings header
    containerEl.createEl("h2", { text: "数位板设置" });

    // Enable Pressure Sensitivity
    new Setting(containerEl)
      .setName("启用压感")
      .setDesc("根据笔触压力调整线条粗细")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enablePressureSensitivity)
          .onChange(async (value) => {
            this.plugin.settings.enablePressureSensitivity = value;
            await this.plugin.saveSettings();
          })
      );

    // Pressure Min Width
    new Setting(containerEl)
      .setName("最小线条宽度")
      .setDesc("压感最轻时的线条宽度")
      .addSlider((slider) =>
        slider
          .setLimits(0.5, 5, 0.5)
          .setValue(this.plugin.settings.pressureMinWidth)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.pressureMinWidth = value;
            await this.plugin.saveSettings();
          })
      );

    // Pressure Max Width
    new Setting(containerEl)
      .setName("最大线条宽度")
      .setDesc("压感最重时的线条宽度")
      .addSlider((slider) =>
        slider
          .setLimits(2, 20, 1)
          .setValue(this.plugin.settings.pressureMaxWidth)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.pressureMaxWidth = value;
            await this.plugin.saveSettings();
          })
      );

    // Enable Palm Rejection
    new Setting(containerEl)
      .setName("防误触")
      .setDesc("使用数位笔时忽略触摸输入")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enablePalmRejection)
          .onChange(async (value) => {
            this.plugin.settings.enablePalmRejection = value;
            await this.plugin.saveSettings();
          })
      );

    // Enable Line Smoothing
    new Setting(containerEl)
      .setName("线条平滑")
      .setDesc("平滑手绘线条，减少锯齿")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableLineSmoothing)
          .onChange(async (value) => {
            this.plugin.settings.enableLineSmoothing = value;
            await this.plugin.saveSettings();
          })
      );

    // Smoothing Factor
    new Setting(containerEl)
      .setName("平滑程度")
      .setDesc("线条平滑的强度（越高越平滑）")
      .addSlider((slider) =>
        slider
          .setLimits(0.1, 0.9, 0.1)
          .setValue(this.plugin.settings.smoothingFactor)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.smoothingFactor = value;
            await this.plugin.saveSettings();
          })
      );

    // Pen Button 1 Tool
    new Setting(containerEl)
      .setName("笔按钮1功能")
      .setDesc("数位笔第一个按钮的快捷功能")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("select", "选择")
          .addOption("pen", "画笔")
          .addOption("eraser", "橡皮擦")
          .addOption("highlight", "高亮")
          .addOption("text", "文本")
          .addOption("note", "备注")
          .setValue(this.plugin.settings.penButton1Tool)
          .onChange(async (value) => {
            this.plugin.settings.penButton1Tool = value;
            await this.plugin.saveSettings();
          })
      );

    // Pen Button 2 Tool
    new Setting(containerEl)
      .setName("笔按钮2功能")
      .setDesc("数位笔第二个按钮的快捷功能")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("select", "选择")
          .addOption("pen", "画笔")
          .addOption("eraser", "橡皮擦")
          .addOption("highlight", "高亮")
          .addOption("text", "文本")
          .addOption("note", "备注")
          .setValue(this.plugin.settings.penButton2Tool)
          .onChange(async (value) => {
            this.plugin.settings.penButton2Tool = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
