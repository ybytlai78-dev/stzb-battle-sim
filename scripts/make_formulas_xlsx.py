# -*- coding: utf-8 -*-
"""
生成《率土之滨》战斗公式 Excel 计算表：
  Sheet1 说明        —— 公式总览与来源
  Sheet2 物理伤害    —— 三部分相加模型 + 3 张图表
  Sheet3 谋略伤害    —— 三部分相加 + 受谋略成长 + 目标谋略减伤 + 4 张图表
  Sheet4 兵力恢复    —— 恢复率受谋略成长 + 恢复量 + 2 张图表 + 验证锚点
所有计算均为 Excel 公式（非硬编码数值），图表引用公式单元格，输入修改后自动更新。
数据来源：dateyuan/战斗伤害公式调研.md、dateyuan/谋略战法受谋略成长调研.md、src/engine/formulas.ts
"""
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.chart import LineChart, Reference
from openpyxl.comments import Comment

OUT = r"C:\Users\lai15\Desktop\战斗系统\战斗公式计算表.xlsx"

# ── 样式 ──
BLUE_FONT = Font(color="0000FF")
GRAY_FONT = Font(color="808080")
INPUT_FILL = PatternFill("solid", start_color="FFFFCC")
HEAD_FONT = Font(bold=True, color="FFFFFF", size=11)
TITLE_FONT = Font(bold=True, size=15, color="1F3864")
NOTE_FONT = Font(size=10, color="404040")
thin = Side(style="thin", color="BFBFBF")
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)
CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)
LEFT = Alignment(horizontal="left", vertical="center")


def head_cell(ws, coord, text, fill):
    c = ws[coord]
    c.value = text
    c.font = HEAD_FONT
    c.fill = PatternFill("solid", start_color=fill)
    c.alignment = CENTER
    c.border = BORDER


def data_cell(ws, coord, value, fmt=None, font=None):
    c = ws[coord]
    c.value = value
    if fmt:
        c.number_format = fmt
    if font:
        c.font = font
    c.border = BORDER
    return c


def input_cell(ws, coord, value, fmt, comment=None):
    c = data_cell(ws, coord, value, fmt, BLUE_FONT)
    c.fill = INPUT_FILL
    if comment:
        c.comment = Comment(comment, "公式表")
    return c


def label_cell(ws, coord, text, bold=False, color="000000"):
    c = ws[coord]
    c.value = text
    c.alignment = LEFT
    c.font = Font(bold=bold, color=color)
    return c


def section_label(ws, coord, text, color):
    c = ws[coord]
    c.value = text
    c.font = Font(bold=True, size=11, color=color)
    c.alignment = LEFT
    return c


def add_chart(ws, anchor, title, x_title, y_title, data_refs, cats_ref, w=15, h=8.5):
    ch = LineChart()
    ch.title = title
    ch.x_axis.title = x_title
    ch.y_axis.title = y_title
    ch.width = w
    ch.height = h
    ch.legend.position = "b"
    for ref in data_refs:
        ch.add_data(ref, titles_from_data=True)
    ch.set_categories(cats_ref)
    ws.add_chart(ch, anchor)
    return ch


def set_widths(ws, widths):
    for col, w in widths.items():
        ws.column_dimensions[col].width = w


wb = Workbook()
wb.calculation.fullCalcOnLoad = True

# ══════════════════════════ Sheet1 说明 ══════════════════════════
ws = wb.active
ws.title = "说明"
ws.sheet_properties.tabColor = "808080"
set_widths(ws, {"A": 12, "B": 95})

ws["A1"] = "《率土之滨》战斗公式 Excel 计算表"
ws["A1"].font = TITLE_FONT
ws["A2"] = "物理伤害 / 谋略伤害 / 兵力恢复 计算公式 + 因变量-自变量图表"
ws["A2"].font = Font(size=12, color="4472C4", bold=True)
ws["A3"] = "公式来源：dateyuan/战斗伤害公式调研.md（伤害三部分相加模型）· dateyuan/谋略战法受谋略成长调研.md（受谋略成长/恢复率）· src/engine/formulas.ts（曲线参数与取整规则，社区战报反推，非官方公布公式）"
ws["A3"].font = NOTE_FONT

ws["A5"] = "使用说明"
ws["A5"].font = Font(bold=True, size=12)
notes = [
    "1. 蓝色数字 = 输入参数（浅黄底），可随意修改；黑色数字 = 公式自动计算。",
    "2. 修改输入后，全部公式与图表自动更新（打开文件时已设置为自动重算；若未刷新按 F9）。",
    "3. 每个工作表的图表均以「表格内某列」为自变量（X 轴）、伤害/恢复为因变量（Y 轴）。",
    "4. 引擎取整规则已内建：1% 粒度「八舍九入」= 小数部分 ≥0.9 进 1 否则舍去；伤害各部分先四舍五入再相加。",
    "5. 「原始值」灰字列仅用于展示取整前的数值，正式口径以取整列为准。",
]
for i, t in enumerate(notes):
    ws.cell(row=6 + i, column=1, value=t)

row = 12
ws.cell(row=row, column=1, value="三个公式总览").font = Font(bold=True, size=12)
row += 1
heads = ["类别", "公式结构", "关键说明"]
for j, h in enumerate(heads, 1):
    head_cell(ws, f"{chr(64 + j)}{row}", h, "4472C4")
row += 1
overview = [
    ("物理（兵刃）伤害",
     "总伤害 = 兵力基础伤害 + 攻击基础伤害 + 主要伤害",
     "兵力基础 = ROUND(373×兵/(7700+兵))；攻击基础 = 攻击×随机系数(0.30~0.39)×伤害率×增减伤因子；主要 = 单位伤害×伤害率×攻防差因子×增减伤因子；单次伤害上限 = 目标当前兵力"),
    ("谋略（策略）伤害",
     "总伤害 = 兵力基础伤害 + 谋略基础伤害 + 主要伤害",
     "兵力基础 = ROUND(178×兵/(6459+兵))（DoT ×1/3）；谋略基础 = 谋略×0.5(DoT 0.25)×目标谋略减伤×增减伤因子；主要 = 单位伤害×有效伤害率×目标谋略减伤×增减伤因子；有效伤害率 = 八舍九入(基础率+成长率×(谋略-80))"),
    ("兵力恢复",
     "恢复值 = FLOOR(ROUND(300×施法者兵力/(3500+施法者兵力)) × 恢复率/100 × (1+恢复提高效果))",
     "恢复率 = 八舍九入(基础恢复率 + 成长率×(谋略-80))；谋略<80 时按 基础×0.4+基础×0.6×(谋略/80) 折减；实际恢复量 ≤ 伤兵池 且 ≤ 兵力缺口（引擎 recoverTroops）；⚠️ 原文为 300×兵力（乘号）"),
]
for cat, f, d in overview:
    ws.cell(row=row, column=1, value=cat).border = BORDER
    ws.cell(row=row, column=2, value=f).border = BORDER
    ws.cell(row=row, column=3, value=d).border = BORDER
    for j in range(1, 4):
        ws.cell(row=row, column=j).alignment = LEFT
    row += 1

row += 1
ws.cell(row=row, column=1, value="共用因子与取整规则").font = Font(bold=True, size=12)
row += 1
shared = [
    "单位伤害曲线（物理/谋略/恢复共用）：unitDamage = 300×兵/(3500+兵)，9000 兵 ≈216、10000 兵 ≈222",
    "攻防差因子：攻防差 = 攻击-目标防御；攻防差 ≥0 → 3-500/(250+攻防差)；<0 → 100/(100-攻防差)；保留两位小数（高收益区间 -70~130）",
    "目标谋略减伤：≤50 无减伤；>50 → CEILING(100-(75-9375/(75+目标谋略)))/100，下限 0.10（52 起每档约 -1%，>129 后边际很小）",
    "受谋略成长：谋略 ≥80 → 基础值+成长率×(谋略-80)；谋略 <80 → 基础值×0.4+基础值×0.6×(谋略/80)",
    "八舍九入（roundRate）：小数部分 ≥0.9 进 1，否则舍去（如 40.9→41，40.5→40）",
    "增减伤因子（单一总和，物理/谋略统一，v0.14 权威复核）：因子 = max(10%, 1 + Σ增伤 − Σ减伤)；例 增60%+减60% → 1.0",
    "士气系数（未入图）：每点士气 +0.6% 发动率，100→1.0、120→1.12（moraleRate）",
    "随机波动仅存在于攻击基础随机系数 0.30~0.39（无宏观 ±5% 波动，v0.14 已删除）",
]
for t in shared:
    ws.cell(row=row, column=1, value="• " + t)
    row += 1

# ══════════════════════════ Sheet2 物理伤害 ══════════════════════════
ws = wb.create_sheet("物理伤害")
ws.sheet_properties.tabColor = "4472C4"
set_widths(ws, {"A": 12, "B": 22, "C": 16, "D": 16, "E": 16, "F": 12, "G": 4, "H": 4, "I": 4})

ws["A1"] = "物理（兵刃）伤害计算公式"
ws["A1"].font = TITLE_FONT
ws["A2"] = "总伤害 = 兵力基础伤害 + 攻击基础伤害 + 主要伤害；单次伤害上限 = 目标当前兵力；攻击基础随机系数 0.30~0.39（图表取均值 0.345）"
ws["A2"].font = NOTE_FONT

labels_in = [
    (4, "攻击属性", 200, "0", "施法者攻击（含加成）。来源：战斗伤害公式调研.md §2"),
    (5, "目标防御", 150, "0", "攻防差 = 攻击-防御，高收益区间 -70~130（§2.4）"),
    (6, "伤害率（%）", 100, "0", "兵刃战法伤害率，通常不受属性影响"),
    (7, "攻击基础随机系数（0.30~0.39）", 0.345, "0.000", "攻击基础每次攻击随机取 0.30~0.39，图表取均值 0.345（§2.3）；无宏观 ±5% 波动"),
    (8, "增伤合计（%，正值）", 0, "0", "所有增伤数值相加（大赏三军/神兵天降等，造成侧+受到侧）"),
    (9, "减伤合计（%，正值）", 0, "0", "所有减伤数值相加（避其锋芒/步步为营等受击方减伤）"),
    (10, "兵力（图表③固定值）", 9000, "0", "图表③「总伤害 vs 攻击」时使用的固定兵力"),
]
for r, lab, val, fmt, cmt in labels_in:
    label_cell(ws, f"B{r}", lab)
    input_cell(ws, f"C{r}", val, fmt, cmt)
label_cell(ws, "B11", "增减伤因子（自动计算）", bold=True)
data_cell(ws, "C11", "=MAX(0.1,1+($C$8-$C$9)/100)", "0.00")
ws["C11"].comment = Comment("单一总和模型：因子 = max(10%, 1 + Σ增伤 − Σ减伤)（物理/谋略统一，v0.14 权威复核）", "公式表")
ws["A11"] = "蓝色数字为输入参数；黑色为公式自动计算；修改输入后图表自动更新"
ws["A11"].font = NOTE_FONT

section_label(ws, "A13", "图表① 数据：伤害三部分与总伤害 vs 兵力（自变量=兵力）", "4472C4")
head_cell(ws, "A14", "兵力", "4472C4")
head_cell(ws, "B14", "兵力基础伤害", "4472C4")
head_cell(ws, "C14", "攻击基础伤害", "4472C4")
head_cell(ws, "D14", "主要伤害", "4472C4")
head_cell(ws, "E14", "总伤害", "4472C4")
troops = list(range(0, 15001, 500))
r0 = 15
for i, t in enumerate(troops):
    r = r0 + i
    ws.cell(row=r, column=1, value=t).border = BORDER
    data_cell(ws, f"B{r}", f"=ROUND(373*A{r}/(7700+A{r}),0)", "0")
    data_cell(ws, f"C{r}", f"=ROUND($C$4*$C$7*($C$6/100)*$C$11,0)", "0")
    data_cell(ws, f"D{r}",
              f"=ROUND(300*A{r}/(3500+A{r})*($C$6/100)*ROUND(IF($C$4-$C$5>=0,3-500/(250+($C$4-$C$5)),100/(100-($C$4-$C$5))),2)*$C$11,0)", "0")
    data_cell(ws, f"E{r}", f"=B{r}+C{r}+D{r}", "0")
r_end1 = r0 + len(troops) - 1
add_chart(ws, "G14", "物理伤害 vs 兵力（三部分拆解）", "兵力", "伤害",
          [Reference(ws, min_col=2, min_row=14, max_col=5, max_row=r_end1)],
          Reference(ws, min_col=1, min_row=15, max_row=r_end1))

section_label(ws, "A47", "图表② 数据：攻防差因子 vs 攻防差（自变量=攻防差=攻击-防御）", "4472C4")
head_cell(ws, "A49", "攻防差", "4472C4")
head_cell(ws, "B49", "攻防差因子", "4472C4")
diffs = list(range(-200, 301, 25))
r0 = 50
for i, d in enumerate(diffs):
    r = r0 + i
    ws.cell(row=r, column=1, value=d).border = BORDER
    data_cell(ws, f"B{r}", f"=ROUND(IF(A{r}>=0,3-500/(250+A{r}),100/(100-A{r})),2)", "0.00")
r_end2 = r0 + len(diffs) - 1
add_chart(ws, "D49", "攻防差因子 vs 攻防差", "攻防差（攻击-防御）", "属性影响因子",
          [Reference(ws, min_col=2, min_row=49, max_col=2, max_row=r_end2)],
          Reference(ws, min_col=1, min_row=50, max_row=r_end2), w=15, h=7.5)

section_label(ws, "A72", "图表③ 数据：总伤害 vs 攻击属性（目标防御 150、兵力 9000、伤害率 100% 固定）", "4472C4")
head_cell(ws, "A74", "攻击", "4472C4")
head_cell(ws, "B74", "攻防差", "4472C4")
head_cell(ws, "C74", "攻击基础伤害", "4472C4")
head_cell(ws, "D74", "主要伤害", "4472C4")
head_cell(ws, "E74", "兵力基础伤害", "4472C4")
head_cell(ws, "F74", "总伤害", "4472C4")
atks = list(range(50, 401, 25))
r0 = 75
for i, a in enumerate(atks):
    r = r0 + i
    ws.cell(row=r, column=1, value=a).border = BORDER
    data_cell(ws, f"B{r}", f"=A{r}-$C$5", "0")
    data_cell(ws, f"C{r}", f"=ROUND(A{r}*$C$7*($C$6/100)*$C$11,0)", "0")
    data_cell(ws, f"D{r}",
              f"=ROUND(300*$C$10/(3500+$C$10)*($C$6/100)*ROUND(IF(B{r}>=0,3-500/(250+B{r}),100/(100-B{r})),2)*$C$11,0)", "0")
    data_cell(ws, f"E{r}", f"=ROUND(373*$C$10/(7700+$C$10),0)", "0")
    data_cell(ws, f"F{r}", f"=C{r}+D{r}+E{r}", "0")
r_end3 = r0 + len(atks) - 1
add_chart(ws, "H74", "总伤害 vs 攻击属性（防御 150 固定）", "攻击属性", "伤害",
          [Reference(ws, min_col=3, min_row=74, max_col=6, max_row=r_end3)],
          Reference(ws, min_col=1, min_row=75, max_row=r_end3), w=15, h=8)

# ══════════════════════════ Sheet3 谋略伤害 ══════════════════════════
ws = wb.create_sheet("谋略伤害")
ws.sheet_properties.tabColor = "7030A0"
set_widths(ws, {"A": 12, "B": 18, "C": 16, "D": 16, "E": 16, "F": 12, "G": 4, "H": 4, "I": 4})

ws["A1"] = "谋略（策略）伤害计算公式"
ws["A1"].font = TITLE_FONT
ws["A2"] = "总伤害 = 兵力基础伤害 + 谋略基础伤害 + 主要伤害；有效伤害率受施法者谋略线性成长（八舍九入）；目标谋略阶梯减伤（与双方谋略差无关）"
ws["A2"].font = NOTE_FONT

labels_in = [
    (4, "施法者谋略", 200, "0", "施法者谋略属性（含加成）"),
    (5, "目标谋略", 100, "0", "目标谋略减伤只看目标自身谋略（§3.4），≤50 无减伤"),
    (6, "基础伤害率（%）", 194, "0", "谋略 80 时的战法描述值，如 众谋不懈 194%、落雷 148%（谋略战法受谋略成长调研.md）"),
    (7, "伤害率成长率（%/点）", 1.925, "0.000", "每 +1 谋略伤害率 +N%（众谋不懈 1.925）"),
    (8, "施法者兵力", 9000, "0", "兵力基础伤害与单位伤害的自变量"),
    (9, "增伤合计（%，正值）", 0, "0", "所有增伤数值相加（大赏三军/神兵天降等，造成侧+受到侧）"),
    (10, "减伤合计（%，正值）", 0, "0", "所有减伤数值相加（避其锋芒/金匮要略等受击方减伤）"),
]
for r, lab, val, fmt, cmt in labels_in:
    label_cell(ws, f"B{r}", lab)
    input_cell(ws, f"C{r}", val, fmt, cmt)
label_cell(ws, "B13", "增减伤因子（自动计算）", bold=True)
data_cell(ws, "C13", "=MAX(0.1,1+($C$9-$C$10)/100)", "0.00")

label_cell(ws, "B11", "当前有效伤害率·原始值（%）", bold=True)
data_cell(ws, "C11", f"=IF(C4>=80,C6+C7*(C4-80),C6*0.4+C6*0.6*(C4/80))", "0.00")
label_cell(ws, "B12", "当前有效伤害率·八舍九入（%）", bold=True)
data_cell(ws, "C12", "=INT(C11)+IF(C11-INT(C11)>=0.9,1,0)", "0")

section_label(ws, "A14", "图表① 数据：有效伤害率 vs 施法者谋略（自变量=谋略，含 <80 折减）", "7030A0")
head_cell(ws, "A16", "施法者谋略", "7030A0")
head_cell(ws, "B16", "有效伤害率·原始值(%)", "7030A0")
head_cell(ws, "C16", "有效伤害率·取整(%)", "7030A0")
strats = list(range(0, 301, 10))
r0 = 17
for i, s in enumerate(strats):
    r = r0 + i
    ws.cell(row=r, column=1, value=s).border = BORDER
    data_cell(ws, f"B{r}", f"=IF(A{r}>=80,$C$6+$C$7*(A{r}-80),$C$6*0.4+$C$6*0.6*(A{r}/80))", "0.00", GRAY_FONT)
    data_cell(ws, f"C{r}", f"=INT(B{r})+IF(B{r}-INT(B{r})>=0.9,1,0)", "0")
r_end1 = r0 + len(strats) - 1
add_chart(ws, "E16", "有效伤害率 vs 施法者谋略（八舍九入）", "施法者谋略", "有效伤害率(%)",
          [Reference(ws, min_col=3, min_row=16, max_col=3, max_row=r_end1)],
          Reference(ws, min_col=1, min_row=17, max_row=r_end1))

section_label(ws, "A49", "图表② 数据：谋略伤害拆解 vs 施法者谋略（目标谋略 100、兵力 9000 固定）", "7030A0")
head_cell(ws, "A51", "施法者谋略", "7030A0")
head_cell(ws, "B51", "兵力基础伤害", "7030A0")
head_cell(ws, "C51", "谋略基础伤害", "7030A0")
head_cell(ws, "D51", "主要伤害", "7030A0")
head_cell(ws, "E51", "总伤害", "7030A0")
MIT = "IF(INT($C$5)<=50,1,MAX(0.1,CEILING(100-(75-9375/(75+INT($C$5))),1)/100))"
r0 = 52
for i, s in enumerate(strats):
    r = r0 + i
    ws.cell(row=r, column=1, value=s).border = BORDER
    data_cell(ws, f"B{r}", f"=ROUND(178*$C$8/(6459+$C$8),0)", "0")
    data_cell(ws, f"C{r}", f"=ROUND(A{r}*0.5*{MIT}*$C$13,0)", "0")
    data_cell(ws, f"D{r}", f"=ROUND(300*$C$8/(3500+$C$8)*(C{r}/100)*{MIT}*$C$13,0)", "0")
    data_cell(ws, f"E{r}", f"=B{r}+C{r}+D{r}", "0")
r_end2 = r0 + len(strats) - 1
add_chart(ws, "G51", "谋略伤害拆解 vs 施法者谋略", "施法者谋略", "伤害",
          [Reference(ws, min_col=2, min_row=51, max_col=5, max_row=r_end2)],
          Reference(ws, min_col=1, min_row=52, max_row=r_end2))

section_label(ws, "A84", "图表③ 数据：目标谋略减伤因子 vs 目标谋略（自变量=目标谋略）", "7030A0")
head_cell(ws, "A86", "目标谋略", "7030A0")
head_cell(ws, "B86", "目标谋略减伤因子", "7030A0")
r0 = 87
for i, s in enumerate(strats):
    r = r0 + i
    ws.cell(row=r, column=1, value=s).border = BORDER
    data_cell(ws, f"B{r}", f"=IF(INT(A{r})<=50,1,MAX(0.1,CEILING(100-(75-9375/(75+INT(A{r}))),1)/100))", "0.00")
r_end3 = r0 + len(strats) - 1
add_chart(ws, "D86", "目标谋略减伤因子 vs 目标谋略", "目标谋略", "减伤因子",
          [Reference(ws, min_col=2, min_row=86, max_col=2, max_row=r_end3)],
          Reference(ws, min_col=1, min_row=87, max_row=r_end3), w=15, h=7.5)

section_label(ws, "A119", "图表④ 数据：谋略伤害 vs 施法者兵力（施法者谋略 200、目标谋略 100 固定）", "7030A0")
head_cell(ws, "A121", "兵力", "7030A0")
head_cell(ws, "B121", "兵力基础伤害", "7030A0")
head_cell(ws, "C121", "谋略基础伤害", "7030A0")
head_cell(ws, "D121", "主要伤害", "7030A0")
head_cell(ws, "E121", "总伤害", "7030A0")
r0 = 122
for i, t in enumerate(troops):
    r = r0 + i
    ws.cell(row=r, column=1, value=t).border = BORDER
    data_cell(ws, f"B{r}", f"=ROUND(178*A{r}/(6459+A{r}),0)", "0")
    data_cell(ws, f"C{r}", f"=ROUND($C$4*0.5*{MIT}*$C$13,0)", "0")
    data_cell(ws, f"D{r}", f"=ROUND(300*A{r}/(3500+A{r})*($C$12/100)*{MIT}*$C$13,0)", "0")
    data_cell(ws, f"E{r}", f"=B{r}+C{r}+D{r}", "0")
r_end4 = r0 + len(troops) - 1
add_chart(ws, "G121", "谋略伤害 vs 施法者兵力", "兵力", "伤害",
          [Reference(ws, min_col=2, min_row=121, max_col=5, max_row=r_end4)],
          Reference(ws, min_col=1, min_row=122, max_row=r_end4))

# ══════════════════════════ Sheet4 兵力恢复 ══════════════════════════
ws = wb.create_sheet("兵力恢复")
ws.sheet_properties.tabColor = "548235"
set_widths(ws, {"A": 12, "B": 20, "C": 20, "D": 20, "E": 20, "F": 20, "G": 20, "H": 16, "I": 16, "J": 16, "K": 16, "L": 16, "M": 16, "N": 4, "O": 4})

ws["A1"] = "兵力恢复计算公式"
ws["A1"].font = TITLE_FONT
ws["A2"] = "恢复值 = FLOOR(ROUND(300×施法者兵力/(3500+施法者兵力)) × 恢复率/100 × (1+恢复提高效果))；恢复率 = 八舍九入(基础恢复率 + 成长率×(谋略-80))，谋略<80 折减；实际恢复量 ≤ 伤兵池 且 ≤ 兵力缺口"
ws["A2"].font = NOTE_FONT

label_cell(ws, "B4", "施法者兵力（单位伤害曲线用）", bold=True)
input_cell(ws, "C4", 9000, "0", "恢复值 = floor(round(300×施法者兵力/(3500+施法者兵力)) × 恢复率/100 × (1+恢复提高))；状态类恢复（休整/持续急救）取「状态被施加那一刻」的施法者兵力（十面埋伏《率土秘卷一：恢复效果》）")
label_cell(ws, "B5", "目标最大兵力", bold=True)
input_cell(ws, "C5", 9000, "0", "实际恢复量 ≤ 伤兵池 且 ≤ 最大兵力−当前兵力（recoverTroops）")
label_cell(ws, "B6", "目标当前兵力（截断示例）", bold=True)
input_cell(ws, "C6", 8000, "0", "K/L/M 列实际恢复量的截断示例参数")

head_cell(ws, "A7", "战法", "548235")
head_cell(ws, "B7", "基础恢复率(%·谋略80)", "548235")
head_cell(ws, "C7", "成长率(%/点)", "548235")
head_cell(ws, "D7", "来源", "548235")
params = [
    ("三军之众", 151, 1.575, "谋略战法受谋略成长调研.md §二（已验证，S主动）"),
    ("皇裔流离", 68, 0.6, "谋略战法受谋略成长调研.md §二（刘备，一类指挥）"),
    ("金匮要略", 80, 0.75, "谋略战法受谋略成长调研.md §二（张机，一类指挥）"),
]
for i, (name, base, grow, src) in enumerate(params):
    r = 8 + i
    data_cell(ws, f"A{r}", name)
    input_cell(ws, f"B{r}", base, "0.0", f"基础恢复率（谋略 80 时）。来源：{src}")
    input_cell(ws, f"C{r}", grow, "0.000", f"每 +1 谋略恢复率 +N%。来源：{src}")
    data_cell(ws, f"D{r}", src, None, GRAY_FONT)

label_cell(ws, "B12", "目标伤兵池（截断示例）", bold=True)
input_cell(ws, "C12", 1000, "0", "K/L/M 列实际恢复量的截断示例参数")
label_cell(ws, "B13", "恢复提高效果（%）", bold=True)
input_cell(ws, "C13", 0, "0", "极罕见（宝物博浪【抖擞】/锻造【仁心】），默认 0")

section_label(ws, "A15", "图表①② 数据：恢复率 / 恢复值 vs 施法者谋略（自变量=谋略）", "548235")
heads = ["施法者谋略", "三军之众·原始率(%)", "三军之众·恢复率(%)", "皇裔流离·原始率(%)", "皇裔流离·恢复率(%)",
         "金匮要略·原始率(%)", "金匮要略·恢复率(%)", "三军之众·恢复值", "皇裔流离·恢复值", "金匮要略·恢复值",
         "三军之众·实际恢复", "皇裔流离·实际恢复", "金匮要略·实际恢复"]
for j, h in enumerate(heads, 1):
    head_cell(ws, f"{chr(64 + j)}17", h, "548235")
r0 = 18
for i, s in enumerate(strats):
    r = r0 + i
    ws.cell(row=r, column=1, value=s).border = BORDER
    data_cell(ws, f"B{r}", f"=IF($A{r}>=80,$B$8+$C$8*($A{r}-80),$B$8*0.4+$B$8*0.6*($A{r}/80))", "0.00", GRAY_FONT)
    data_cell(ws, f"C{r}", f"=INT(B{r})+IF(B{r}-INT(B{r})>=0.9,1,0)", "0")
    data_cell(ws, f"D{r}", f"=IF($A{r}>=80,$B$9+$C$9*($A{r}-80),$B$9*0.4+$B$9*0.6*($A{r}/80))", "0.00", GRAY_FONT)
    data_cell(ws, f"E{r}", f"=INT(D{r})+IF(D{r}-INT(D{r})>=0.9,1,0)", "0")
    data_cell(ws, f"F{r}", f"=IF($A{r}>=80,$B$10+$C$10*($A{r}-80),$B$10*0.4+$B$10*0.6*($A{r}/80))", "0.00", GRAY_FONT)
    data_cell(ws, f"G{r}", f"=INT(F{r})+IF(F{r}-INT(F{r})>=0.9,1,0)", "0")
    # 恢复值 = floor(round(300×施法者兵力/(3500+施法者兵力)) × 恢复率/100 × (1+恢复提高))
    data_cell(ws, f"H{r}", f"=FLOOR(ROUND(300*$C$4/(3500+$C$4),0)*C{r}/100*(1+$C$13/100),1)", "0")
    data_cell(ws, f"I{r}", f"=FLOOR(ROUND(300*$C$4/(3500+$C$4),0)*E{r}/100*(1+$C$13/100),1)", "0")
    data_cell(ws, f"J{r}", f"=FLOOR(ROUND(300*$C$4/(3500+$C$4),0)*G{r}/100*(1+$C$13/100),1)", "0")
    # 实际恢复量：min(恢复值, 伤兵池, 兵力缺口)（recoverTroops）
    data_cell(ws, f"K{r}", f"=MAX(0,MIN(H{r},$C$12,$C$5-$C$6))", "0")
    data_cell(ws, f"L{r}", f"=MAX(0,MIN(I{r},$C$12,$C$5-$C$6))", "0")
    data_cell(ws, f"M{r}", f"=MAX(0,MIN(J{r},$C$12,$C$5-$C$6))", "0")
r_end = r0 + len(strats) - 1
add_chart(ws, "O17", "恢复率 vs 谋略（八舍九入后）", "施法者谋略", "恢复率(%)",
          [Reference(ws, min_col=3, min_row=17, max_col=3, max_row=r_end),
           Reference(ws, min_col=5, min_row=17, max_col=5, max_row=r_end),
           Reference(ws, min_col=7, min_row=17, max_col=7, max_row=r_end)],
          Reference(ws, min_col=1, min_row=18, max_row=r_end), w=16, h=8)
add_chart(ws, "O35", "恢复值 vs 谋略（施法者兵力 9000）", "施法者谋略", "恢复兵力",
          [Reference(ws, min_col=8, min_row=17, max_col=8, max_row=r_end),
           Reference(ws, min_col=9, min_row=17, max_col=9, max_row=r_end),
           Reference(ws, min_col=10, min_row=17, max_col=10, max_row=r_end)],
          Reference(ws, min_col=1, min_row=18, max_row=r_end), w=16, h=8)

section_label(ws, "A50", "验证锚点①：恢复率（对照调研文档）", "548235")
head_cell(ws, "A52", "战法", "548235")
head_cell(ws, "B52", "谋略", "548235")
head_cell(ws, "C52", "文档期望(%)", "548235")
head_cell(ws, "D52", "公式计算(%)", "548235")
head_cell(ws, "E52", "一致?", "548235")
anchors = [("皇裔流离", 80, 68, "E26"), ("皇裔流离", 200, 140, "E38"),
           ("金匮要略", 80, 80, "G26"), ("三军之众", 80, 151, "C26"), ("三军之众", 200, 340, "C38")]
for i, (name, s, expect, ref) in enumerate(anchors):
    r = 53 + i
    data_cell(ws, f"A{r}", name)
    data_cell(ws, f"B{r}", s, "0")
    data_cell(ws, f"C{r}", expect, "0")
    data_cell(ws, f"D{r}", f"={ref}", "0")
    data_cell(ws, f"E{r}", f'=IF(C{r}=D{r},"✓","✗")')

section_label(ws, "A59", "验证锚点②：伤害与恢复公式锚点（对照调研文档）", "548235")
head_cell(ws, "A61", "项目", "548235")
head_cell(ws, "B61", "公式计算", "548235")
head_cell(ws, "C61", "文档期望", "548235")
head_cell(ws, "D61", "一致?", "548235")
anchors2 = [
    ("物理兵力基础伤害（10000 兵，期望≈211）", "=ROUND(373*10000/(7700+10000),0)", 211),
    ("谋略兵力基础伤害（10000 兵，期望≈108）", "=ROUND(178*10000/(6459+10000),0)", 108),
    ("攻防差因子（攻防差=100，期望 1.57）", "=ROUND(3-500/(250+100),2)", 1.57),
    ("攻防差因子（攻防差=-70，期望 0.59）", "=ROUND(100/(100-(-70)),2)", 0.59),
    ("恢复值（皇裔流离 9500兵·谋略269→恢复率181%，战报期望 396）", "=FLOOR(ROUND(300*9500/(3500+9500),0)*181/100,1)", 396),
]
for i, (name, f, expect) in enumerate(anchors2):
    r = 62 + i
    data_cell(ws, f"A{r}", name)
    data_cell(ws, f"B{r}", f, "0.00")
    data_cell(ws, f"C{r}", expect, "0.00")
    data_cell(ws, f"D{r}", f'=IF(ROUND(B{r},2)=C{r},"✓","✗")')

wb.save(OUT)
print(f"OK: {OUT}")
