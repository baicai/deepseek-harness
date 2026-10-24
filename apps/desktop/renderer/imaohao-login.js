'use strict'
const form = document.getElementById('login-form')
const status = document.getElementById('message')
const button = document.getElementById('login-button')
document.getElementById('mouse-open').addEventListener('click', () => { void window.imaohaoDemo.mouseDevices() })
form.addEventListener('submit', async event => {
  event.preventDefault()
  status.textContent = ''
  button.disabled = true
  try {
    const result = await window.imaohaoDemo.login(
      document.getElementById('username').value,
      document.getElementById('password').value,
    )
    if (!result.ok) status.textContent = result.message ?? '演示登录失败'
  } catch {
    status.textContent = '演示网关暂时不可用'
  } finally {
    button.disabled = false
  }
})
