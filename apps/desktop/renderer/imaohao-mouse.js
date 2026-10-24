'use strict'
const el = id => document.getElementById(id)
let events = 0
function render(state) {
  const count = state.devices?.length ?? state.connected ?? 0
  el('count').textContent = String(count)
  el('version').textContent = state.version || '—'
  el('dot').className = 'dot ' + (state.phase === 'ready' ? 'ready' : state.phase === 'error' ? 'error' : '')
  const phases = {ready: 'SDK 已启动', starting: 'SDK 正在启动', unavailable: 'SDK 未安装或无法加载', error: 'SDK 运行异常', stopped: 'SDK 已停止'}
  el('state').textContent = phases[state.phase] || '状态未知'
  el('hint').textContent = state.phase === 'ready'
    ? count > 0 ? '已发现真实声云鼠标，可按下硬件按键查看事件。' : 'SDK 已正常运行，尚未发现鼠标。请插入 USB 接收器或完成蓝牙配对。'
    : '这不是模拟设备。请检查 SDK、驱动或重启客户端。'
  const target = el('devices')
  target.replaceChildren()
  if (count === 0) {
    const p = document.createElement('p')
    p.className = 'empty'; p.textContent = '未连接设备 · 请使用声云智能鼠标真机测试'; target.append(p)
  } else {
    for (const [index, device] of (state.devices || []).entries()) {
      const row = document.createElement('div'); row.className = 'device'
      const info = document.createElement('div'), title = document.createElement('strong'), id = document.createElement('small')
      title.textContent = '智能鼠标 ' + String(index + 1)
      // Show only the last 4 SN characters; do not reveal full hardware identifiers.
      id.textContent = '设备标识 ···' + device.deviceId.slice(-4)
      info.append(title,id)
      const transport = document.createElement('span'); transport.className = 'transport'; transport.textContent = device.mode === 1 ? '蓝牙 BLE' : 'USB'
      row.append(info,transport); target.append(row)
    }
  }
}
function addEvent(label) {
  const list = el('events')
  if (events === 0) list.replaceChildren()
  events++
  el('event-count').textContent = String(events)
  const row = document.createElement('li'), time = document.createElement('time')
  time.textContent = new Date().toLocaleTimeString('zh-CN', {hour12:false})
  row.append(time,document.createTextNode(label))
  list.prepend(row)
  while (list.childElementCount > 30) list.lastElementChild.remove()
}
window.imaohaoMouse.onStatus(render)
window.imaohaoMouse.onEvent(event => {
  if (event.kind === 'audio') return  // Never display, persist or echo PCM.
  if (event.kind === 'connected') addEvent('设备连接 · ' + (event.mode === 1 ? 'BLE' : 'USB'))
  if (event.kind === 'disconnected') addEvent('设备断开')
  if (event.kind === 'message') {
    const msg = event.event
    if (msg.type === 'keyEvent') addEvent('按键 · ' + String(msg.key || '?').slice(0,24) + ' / ' + String(msg.action || '?').slice(0,20))
    else if (msg.type === 'warning') addEvent('SDK 提示 · ' + String(msg.code || 'warning').slice(0,60))
    else if (msg.type === 'deviceInfo') addEvent('设备信息更新')
    else if (msg.type === 'queueOverflow') addEvent('设备事件处理队列溢出')
  }
})
window.imaohaoMouse.status().then(render).catch(() => {
  render({phase:'error',version:undefined,connected:0,devices:[]})
})
