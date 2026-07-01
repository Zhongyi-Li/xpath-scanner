import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildElementPath,
  describeElementSemantics,
  shouldCollectElementRegion,
  shouldCollectTableElement,
} from '../src/element-semantics';
import { excludeElementRows } from '../src/row-filter';
import { buildOutputColumnWidths } from '../src/excel-layout';
import { formatFramedXPath, isForbiddenFrameUrl } from '../src/frame-locator';
import {
  buildContainerContextXPathCandidates,
  buildFieldLabelXPathCandidates,
  isStableStaticContextText,
} from '../src/xpath-context';
import { selectStableXPath } from '../src/xpath-selection';

const visibleNodePredicate =
  "not(@hidden) and not(@aria-hidden='true') and not(ancestor::*[@hidden or @aria-hidden='true'])";

test('字段标签候选在最近表单项内定位控件且不包含当前输入值', () => {
  const candidates = buildFieldLabelXPathCandidates({
    tag: 'input',
    fieldLabel: '仓库名称',
    visibleNodePredicate,
  });

  assert.deepEqual(candidates, [
    "//*[normalize-space(.)='仓库名称']/ancestor-or-self::*[.//input][1]//input[not(@hidden) and not(@aria-hidden='true') and not(ancestor::*[@hidden or @aria-hidden='true'])]",
    "//*[normalize-space(translate(., '：:*', ''))='仓库名称']/ancestor-or-self::*[.//input][1]//input[not(@hidden) and not(@aria-hidden='true') and not(ancestor::*[@hidden or @aria-hidden='true'])]",
  ]);
  assert.equal(candidates.some((xpath) => xpath.includes('上海一号仓')), false);
});

test('非表格容器使用静态标题和操作文案生成上下文 XPath', () => {
  assert.deepEqual(
    buildContainerContextXPathCandidates({
      containerTag: 'section',
      containerTitle: '仓库管理',
      targetTag: 'button',
      targetText: '编辑仓库',
      visibleNodePredicate,
    }),
    [
      "//section[.//*[normalize-space(.)='仓库管理']]//button[normalize-space(.)='编辑仓库' and not(@hidden) and not(@aria-hidden='true') and not(ancestor::*[@hidden or @aria-hidden='true'])]",
    ],
  );
});

test('动态业务文案不能作为非表格容器 XPath 上下文', () => {
  for (const text of [
    '仓库ID 653359394333',
    '创建时间 2026-07-01',
    '库存金额 ¥12,000.00',
    '这是一个包含大量业务描述并且不适合作为稳定定位上下文的超长仓库名称',
  ]) {
    assert.equal(isStableStaticContextText(text), false, text);
  }
  assert.equal(isStableStaticContextText('仓库管理'), true);
});

test('role XPath 命中多个时选择后续唯一的文案组合 XPath', () => {
  assert.deepEqual(
    selectStableXPath([
      { xpath: "//div[@role='checkbox']", count: 5 },
      { xpath: "//div[@role='checkbox' and normalize-space(.)='处罚']", count: 1 },
    ]),
    {
      xpath: "//div[@role='checkbox' and normalize-space(.)='处罚']",
      successFlag: '成功',
    },
  );
});

test('没有唯一 XPath 时保留首个可命中候选并标记多元素命中', () => {
  assert.deepEqual(
    selectStableXPath([
      { xpath: "//div[@role='checkbox']", count: 5 },
      { xpath: "//div[normalize-space(.)='重复文案']", count: 2 },
    ]),
    { xpath: "//div[@role='checkbox']", successFlag: '多元素命中' },
  );
});

test('iframe 内元素定位方式包含有序的 frame XPath 链', () => {
  assert.equal(
    formatFramedXPath(
      ["//iframe[@title='投诉管理']", "//iframe[@name='业务表单']"],
      "//input[@name='orderId']",
    ),
    "frame=//iframe[@title='投诉管理'] >>> frame=//iframe[@name='业务表单'] >>> xpath=//input[@name='orderId']",
  );
});

test('登录和风控 iframe URL 不参与扫描', () => {
  const forbiddenParts = ['login.taobao.com', 'captcha', 'verify'];

  assert.equal(
    isForbiddenFrameUrl('https://login.taobao.com/member/login.jhtml', forbiddenParts),
    true,
  );
  assert.equal(
    isForbiddenFrameUrl('https://rights.taobao.com/complaint/sellerList.htm', forbiddenParts),
    false,
  );
});

test('Excel 七列宽度固定为默认列宽的三倍', () => {
  assert.deepEqual(
    buildOutputColumnWidths(7),
    Array.from({ length: 7 }, () => ({ wpx: 192 })),
  );
});

test('左侧导航区域不采集，右侧页面区域继续采集', () => {
  assert.equal(shouldCollectElementRegion('left-navigation'), false);
  assert.equal(shouldCollectElementRegion('page-content'), true);
});

test('清理历史左侧导航时保留右侧同名 Tab', () => {
  const navigationRow = {
    页面路径: '交易 > 评价管理 > 首页',
    元素名称: '首页',
    元素类型: '链接',
    定位方式: "//a[@role='button']",
  };
  const rightTabRow = {
    页面路径: '交易 > 评价管理 > 种草',
    元素名称: '种草',
    元素类型: 'Tab',
    定位方式: "//li[@role='tab']",
  };
  const sameNavigationElsewhere = { ...navigationRow, 页面路径: '任意扫描路径' };

  assert.deepEqual(
    excludeElementRows([navigationRow, rightTabRow], [sameNavigationElsewhere]),
    [rightTabRow],
  );
});

test('页面路径按导航、页面、活动 Tab 和元素名称组成树形路径', () => {
  assert.equal(
    buildElementPath(
      ['交易', '评价管理', '评价管理', '来自买家的评价'],
      '评价时间-开始日期',
    ),
    '交易 > 评价管理 > 来自买家的评价 > 评价时间-开始日期',
  );
});

test('动态表单控件路径包含当前前置 Radio 状态', () => {
  assert.equal(
    buildElementPath(
      ['交易', '改单服务', '改地址', '发货前'],
      '官方改地址是否询问工具-是',
      ['第三方工具'],
    ),
    '交易 > 改单服务 > 改地址 > 发货前 > 第三方工具 > 官方改地址是否询问工具-是',
  );
});

test('日期区间端点使用父级字段名称并标记为日期控件', () => {
  assert.deepEqual(
    describeElementSemantics({
      tag: 'input',
      role: '',
      inputType: '',
      ownText: '',
      ariaLabel: '',
      placeholder: '起始日期',
      title: '',
      value: '',
      fieldLabel: '评价时间',
      isDateRangeContainer: false,
    }),
    { elementName: '评价时间-开始日期', elementType: '日期控件' },
  );

  assert.deepEqual(
    describeElementSemantics({
      tag: 'input',
      role: '',
      inputType: '',
      ownText: '',
      ariaLabel: '',
      placeholder: '结束日期',
      title: '',
      value: '',
      fieldLabel: '评价时间',
      isDateRangeContainer: false,
    }),
    { elementName: '评价时间-结束日期', elementType: '日期控件' },
  );
});

test('日期区间分隔符容器不作为按钮输出', () => {
  assert.equal(
    describeElementSemantics({
      tag: 'div',
      role: 'button',
      inputType: '',
      ownText: '-',
      ariaLabel: '',
      placeholder: '',
      title: '',
      value: '',
      fieldLabel: '评价时间',
      isDateRangeContainer: true,
    }),
    null,
  );
});

test('普通输入框保持原有名称和类型', () => {
  assert.deepEqual(
    describeElementSemantics({
      tag: 'input',
      role: '',
      inputType: 'text',
      ownText: '',
      ariaLabel: '',
      placeholder: '请输入订单编号',
      title: '',
      value: '',
      fieldLabel: '订单编号',
      isDateRangeContainer: false,
    }),
    { elementName: '请输入订单编号', elementType: '输入框' },
  );
});

test('通用占位文案使用字段标签区分同类输入框', () => {
  assert.deepEqual(
    describeElementSemantics({
      tag: 'input',
      role: '',
      inputType: 'text',
      ownText: '',
      ariaLabel: '',
      placeholder: '多个以英文逗号分隔',
      title: '',
      value: '',
      fieldLabel: '订单编号',
      isDateRangeContainer: false,
    }),
    { elementName: '订单编号-多个以英文逗号分隔', elementType: '输入框' },
  );
});

test('明确 placeholder 独立作为元素名称，不拼接表单外的同级视图顺序', () => {
  assert.deepEqual(
    describeElementSemantics({
      tag: 'input',
      role: '',
      inputType: 'text',
      ownText: '',
      ariaLabel: '',
      placeholder: '订单编号',
      title: '',
      value: '',
      fieldLabel: '手工报备一键报备平台主动免责',
      isDateRangeContainer: false,
    }),
    { elementName: '订单编号', elementType: '输入框' },
  );
});

test('活动视图属于页面层级，不属于元素名称', () => {
  assert.equal(
    buildElementPath(
      ['交易', '投诉与申诉', '我要报备', '全部免责订单', '手工报备'],
      '订单编号',
    ),
    '交易 > 投诉与申诉 > 我要报备 > 全部免责订单 > 手工报备 > 订单编号',
  );
});

test('无占位文案的输入框优先使用字段标签而不是动态值', () => {
  assert.deepEqual(
    describeElementSemantics({
      tag: 'input',
      role: '',
      inputType: 'text',
      ownText: '',
      ariaLabel: '',
      placeholder: '',
      title: '',
      value: '动态业务值',
      fieldLabel: '买家昵称',
      isDateRangeContainer: false,
    }),
    { elementName: '买家昵称', elementType: '输入框' },
  );
});

test('无 placeholder 的只读日期区间仍按端点命名', () => {
  assert.deepEqual(
    describeElementSemantics({
      tag: 'input',
      role: '',
      inputType: 'text',
      ownText: '',
      ariaLabel: '',
      placeholder: '',
      title: '',
      value: '动态日期值',
      fieldLabel: '申请时间',
      dateEndpoint: 'end',
      isDateRangeContainer: false,
    }),
    { elementName: '申请时间-结束时间', elementType: '日期控件' },
  );
});

test('原生 checkbox 仍识别为 Checkbox', () => {
  assert.deepEqual(
    describeElementSemantics({
      tag: 'input',
      role: '',
      inputType: 'checkbox',
      ownText: '',
      ariaLabel: '仅查看有内容评价',
      placeholder: '',
      title: '',
      value: '',
      fieldLabel: '',
      isDateRangeContainer: false,
    }),
    { elementName: '仅查看有内容评价', elementType: 'Checkbox' },
  );
});

test('自定义 Radio label 使用表单字段作为名称前缀', () => {
  assert.deepEqual(
    describeElementSemantics({
      tag: 'label',
      role: '',
      inputType: 'radio',
      ownText: '天猫商家中心',
      ariaLabel: '',
      placeholder: '',
      title: '',
      value: '',
      fieldLabel: '发货方式',
      contextLabel: '',
      isDateRangeContainer: false,
    }),
    { elementName: '发货方式-天猫商家中心', elementType: 'Radio' },
  );
});

test('Radio 选项内的下拉框保留字段、选项和占位语义', () => {
  assert.deepEqual(
    describeElementSemantics({
      tag: 'input',
      role: 'combobox',
      inputType: '',
      ownText: '',
      ariaLabel: '',
      placeholder: '请选择',
      title: '',
      value: '',
      fieldLabel: '申请通知',
      contextLabel: '指定处理人',
      isDateRangeContainer: false,
    }),
    { elementName: '申请通知-指定处理人-请选择', elementType: '下拉框' },
  );
});

test('普通下拉框使用表单字段作为名称前缀', () => {
  assert.deepEqual(
    describeElementSemantics({
      tag: 'input',
      role: 'combobox',
      inputType: '',
      ownText: '',
      ariaLabel: '',
      placeholder: '请选择第三方工具',
      title: '',
      value: '',
      fieldLabel: '工具名称',
      contextLabel: '',
      isDateRangeContainer: false,
    }),
    { elementName: '工具名称-请选择第三方工具', elementType: '下拉框' },
  );
});

test('普通 div 上的框架点击事件识别为可点击卡片', () => {
  assert.deepEqual(
    describeElementSemantics({
      tag: 'div',
      role: 'clickable-card',
      inputType: '',
      ownText: '体验管理',
      ariaLabel: '',
      placeholder: '',
      title: '',
      value: '',
      fieldLabel: '',
      isDateRangeContainer: false,
    }),
    { elementName: '体验管理', elementType: '可点击卡片' },
  );
});

test('表格动态业务单元格不采集，操作列和选择框继续采集', () => {
  assert.equal(shouldCollectTableElement('row-dynamic'), false);
  assert.equal(shouldCollectTableElement('row-action'), true);
  assert.equal(shouldCollectTableElement('row-checkbox'), true);
  assert.equal(shouldCollectTableElement('header-control'), true);
  assert.equal(shouldCollectTableElement('outside'), true);
});

test('表格操作列控件标记为表格行操作', () => {
  assert.deepEqual(
    describeElementSemantics({
      tag: 'button',
      role: 'table-row-action',
      inputType: '',
      ownText: '编辑库存',
      ariaLabel: '',
      placeholder: '',
      title: '',
      value: '',
      fieldLabel: '',
      isDateRangeContainer: false,
    }),
    { elementName: '编辑库存', elementType: '表格行操作' },
  );
});
