// iMaoHao uMouse SDK Windows helper: isolates vendor DLLs from Electron's main process.
// The DLL remains vendor-licensed; this helper has no dependency on DSH internals.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <atomic>
#include <condition_variable>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cwchar>
#include <deque>
#include <io.h>
#include <iostream>
#include <fcntl.h>
#include <mutex>
#include <string>
#include <thread>

namespace {
std::mutex lock;
std::condition_variable wake;
std::deque<std::string> queue;
size_t pendingBytes = 0;
std::atomic<bool> stopping{false};
std::atomic<bool> audioEnabled{false};
constexpr size_t MAX_PENDING_BYTES = 8 * 1024 * 1024;
std::string quote(const char* input) {
  std::string out = "\"";
  if (input != nullptr) {
    for (const unsigned char* c = reinterpret_cast<const unsigned char*>(input); *c; ++c) {
      switch (*c) {
      case '\\': out += "\\\\"; break;
      case '"': out += "\\\""; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (*c < 32) { char buf[7]; std::snprintf(buf, sizeof(buf), "\\u%04x", *c); out += buf; }
        else out += static_cast<char>(*c);
      }
    }
  }
  return out + "\"";
}
void publish(std::string message) {
  if (message.size() > 128 * 1024 || stopping.load()) return;
  message.push_back('\n');
  {
    std::lock_guard<std::mutex> hold(lock);
    if (pendingBytes + message.size() > MAX_PENDING_BYTES) return;
    pendingBytes += message.size();
    queue.push_back(std::move(message));
  }
  wake.notify_one();
}
void writer() {
  while (true) {
    std::string message;
    {
      std::unique_lock<std::mutex> hold(lock);
      wake.wait(hold, [] { return stopping || !queue.empty(); });
      if (queue.empty() && stopping) break;
      message = std::move(queue.front());
      queue.pop_front();
      pendingBytes -= message.size();
    }
    if (std::fwrite(message.data(), 1, message.size(), stdout) != message.size()) break;
    std::fflush(stdout);
  }
}
std::string base64(const unsigned char* data, size_t length) {
  static constexpr char symbols[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  out.reserve(((length + 2) / 3) * 4);
  for (size_t pos = 0; pos < length; pos += 3) {
    const size_t remaining = length - pos;
    const unsigned v = (static_cast<unsigned>(data[pos]) << 16)
        | (remaining > 1 ? static_cast<unsigned>(data[pos + 1]) << 8 : 0u)
        | (remaining > 2 ? data[pos + 2] : 0u);
    out += symbols[(v >> 18) & 63]; out += symbols[(v >> 12) & 63];
    out += remaining > 1 ? symbols[(v >> 6) & 63] : '=';
    out += remaining > 2 ? symbols[v & 63] : '=';
  }
  return out;
}
void __cdecl connected(const char* id, int mode) {
  publish("{\"kind\":\"connected\",\"deviceId\":" + quote(id) + ",\"mode\":" + std::to_string(mode) + "}");
}
void __cdecl disconnected(const char* id, int mode) {
  publish("{\"kind\":\"disconnected\",\"deviceId\":" + quote(id) + ",\"mode\":" + std::to_string(mode) + "}");
}
void __cdecl message(const char* id, const char* body) {
  if (body == nullptr || std::strlen(body) > 16000) return;
  publish("{\"kind\":\"message\",\"deviceId\":" + quote(id) + ",\"json\":" + quote(body) + "}");
}
void __cdecl audio(const char* id, const unsigned char* pcm, int size) {
  if (!audioEnabled || pcm == nullptr || size <= 0 || size > 1024 * 1024) return;
  // Callback data is valid only for this call. Encode before returning; enqueue without blocking.
  for (int offset = 0; offset < size; offset += 16384) {
    const int take = size - offset < 16384 ? size - offset : 16384;
    publish("{\"kind\":\"audio\",\"deviceId\":" + quote(id)
        + ",\"format\":\"pcm_s16le\",\"sampleRate\":16000,\"data\":\""
        + base64(pcm + offset, static_cast<size_t>(take)) + "\"}");
  }
}
template <typename T> T symbol(HMODULE module, const char* name) {
  return reinterpret_cast<T>(GetProcAddress(module, name));
}
} // namespace

int wmain(int argc, wchar_t** argv) {
  const bool healthOnly = argc > 1 && std::wcscmp(argv[1], L"--version") == 0;
  audioEnabled = argc > 1 && std::wcscmp(argv[1], L"--audio") == 0;
  wchar_t path[MAX_PATH];
  const DWORD length = GetModuleFileNameW(nullptr, path, MAX_PATH);
  if (!length || length >= MAX_PATH) return 2;
  wchar_t* slash = std::wcsrchr(path, L'\\');
  if (slash == nullptr) return 2;
  wcscpy_s(slash + 1, static_cast<size_t>(MAX_PATH - (slash - path) - 1), L"uMouseSdk.dll");
  const HMODULE module = LoadLibraryExW(path, nullptr,
      LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS);
  if (!module) { std::fprintf(stderr, "uMouse SDK DLL could not load (win32=%lu)\n", GetLastError()); return 3; }
  using RegisterConnected = void (__cdecl *)(void (__cdecl *)(const char*, int));
  using RegisterMessage = void (__cdecl *)(void (__cdecl *)(const char*, const char*));
  using RegisterAudio = void (__cdecl *)(void (__cdecl *)(const char*, const unsigned char*, int));
  using Init = void (__cdecl *)(int);
  using Close = void (__cdecl *)();
  using Version = const char* (__cdecl *)();
  const auto version = symbol<Version>(module, "um_sdk_version");
  const auto init = symbol<Init>(module, "um_sdk_init");
  const auto close = symbol<Close>(module, "um_sdk_close");
  const auto regConnected = symbol<RegisterConnected>(module, "um_register_connected");
  const auto regDisconnected = symbol<RegisterConnected>(module, "um_register_disconnected");
  const auto regMessage = symbol<RegisterMessage>(module, "um_register_message");
  const auto regAudio = symbol<RegisterAudio>(module, "um_register_audio");
  if (!version || !init || !close || !regConnected || !regDisconnected || !regMessage || !regAudio) {
    std::fprintf(stderr, "uMouse SDK ABI not compatible\n"); FreeLibrary(module); return 4;
  }
  const std::string versionText = quote(version());
  if (healthOnly) {
    std::printf("{\"kind\":\"version\",\"version\":%s}\n", versionText.c_str());
    FreeLibrary(module); return 0;
  }
  _setmode(_fileno(stdout), _O_BINARY);
  std::thread sender(writer);
  regConnected(connected);
  regDisconnected(disconnected);
  regMessage(message);
  regAudio(audio);
  init(0);
  publish("{\"kind\":\"ready\",\"version\":" + versionText + "}");
  std::string command;
  while (std::getline(std::cin, command)) {
    if (command == "stop") break;
  }
  close();
  stopping = true;
  wake.notify_one();
  sender.join();
  FreeLibrary(module);
  return 0;
}
