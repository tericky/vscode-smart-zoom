#include <windows.h>
#include <tlhelp32.h>

#include <algorithm>
#include <charconv>
#include <cstdint>
#include <iostream>
#include <limits>
#include <string>
#include <string_view>
#include <system_error>
#include <tuple>
#include <unordered_map>
#include <utility>
#include <vector>

namespace {

constexpr std::string_view kOperation = "getCurrentWindowDisplay";

struct Request {
    std::string operation;
    std::int64_t pid = 0;
    std::string titleHint;
};

class RequestParser {
public:
    explicit RequestParser(std::string_view input) : input_(input) {}

    bool parse(Request& request) {
        skipWhitespace();
        if (!consume('{')) {
            return false;
        }

        bool hasOperation = false;
        bool hasPid = false;
        bool hasTitleHint = false;
        skipWhitespace();
        if (consume('}')) {
            return false;
        }

        while (true) {
            std::string key;
            if (!parseString(key)) {
                return false;
            }
            skipWhitespace();
            if (!consume(':')) {
                return false;
            }
            skipWhitespace();

            if (key == "op") {
                if (hasOperation || !parseString(request.operation)) {
                    return false;
                }
                hasOperation = true;
            } else if (key == "pid") {
                if (hasPid || !parseInteger(request.pid)) {
                    return false;
                }
                hasPid = true;
            } else if (key == "titleHint") {
                if (hasTitleHint || !parseString(request.titleHint)) {
                    return false;
                }
                hasTitleHint = true;
            } else if (!skipValue(0)) {
                return false;
            }

            skipWhitespace();
            if (consume('}')) {
                break;
            }
            if (!consume(',')) {
                return false;
            }
            skipWhitespace();
        }

        skipWhitespace();
        return position_ == input_.size() && hasOperation && hasPid;
    }

private:
    static void appendCodePoint(std::string& output, std::uint32_t codePoint) {
        if (codePoint <= 0x7f) {
            output.push_back(static_cast<char>(codePoint));
        } else if (codePoint <= 0x7ff) {
            output.push_back(static_cast<char>(0xc0 | (codePoint >> 6)));
            output.push_back(static_cast<char>(0x80 | (codePoint & 0x3f)));
        } else if (codePoint <= 0xffff) {
            output.push_back(static_cast<char>(0xe0 | (codePoint >> 12)));
            output.push_back(static_cast<char>(0x80 | ((codePoint >> 6) & 0x3f)));
            output.push_back(static_cast<char>(0x80 | (codePoint & 0x3f)));
        } else {
            output.push_back(static_cast<char>(0xf0 | (codePoint >> 18)));
            output.push_back(static_cast<char>(0x80 | ((codePoint >> 12) & 0x3f)));
            output.push_back(static_cast<char>(0x80 | ((codePoint >> 6) & 0x3f)));
            output.push_back(static_cast<char>(0x80 | (codePoint & 0x3f)));
        }
    }

    bool consume(char expected) {
        if (position_ >= input_.size() || input_[position_] != expected) {
            return false;
        }
        ++position_;
        return true;
    }

    bool parseHexQuad(std::uint32_t& value) {
        if (input_.size() - position_ < 4) {
            return false;
        }

        value = 0;
        for (int index = 0; index < 4; ++index) {
            const char character = input_[position_++];
            value <<= 4;
            if (character >= '0' && character <= '9') {
                value |= static_cast<std::uint32_t>(character - '0');
            } else if (character >= 'a' && character <= 'f') {
                value |= static_cast<std::uint32_t>(character - 'a' + 10);
            } else if (character >= 'A' && character <= 'F') {
                value |= static_cast<std::uint32_t>(character - 'A' + 10);
            } else {
                return false;
            }
        }
        return true;
    }

    bool parseString(std::string& output) {
        if (!consume('"')) {
            return false;
        }

        output.clear();
        while (position_ < input_.size()) {
            const unsigned char character =
                static_cast<unsigned char>(input_[position_++]);
            if (character == '"') {
                return true;
            }
            if (character < 0x20) {
                return false;
            }
            if (character != '\\') {
                output.push_back(static_cast<char>(character));
                continue;
            }
            if (position_ >= input_.size()) {
                return false;
            }

            const char escape = input_[position_++];
            switch (escape) {
                case '"':
                case '\\':
                case '/':
                    output.push_back(escape);
                    break;
                case 'b':
                    output.push_back('\b');
                    break;
                case 'f':
                    output.push_back('\f');
                    break;
                case 'n':
                    output.push_back('\n');
                    break;
                case 'r':
                    output.push_back('\r');
                    break;
                case 't':
                    output.push_back('\t');
                    break;
                case 'u': {
                    std::uint32_t codePoint = 0;
                    if (!parseHexQuad(codePoint)) {
                        return false;
                    }
                    if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
                        if (!consume('\\') || !consume('u')) {
                            return false;
                        }
                        std::uint32_t lowSurrogate = 0;
                        if (!parseHexQuad(lowSurrogate) ||
                            lowSurrogate < 0xdc00 || lowSurrogate > 0xdfff) {
                            return false;
                        }
                        codePoint = 0x10000 +
                            ((codePoint - 0xd800) << 10) +
                            (lowSurrogate - 0xdc00);
                    } else if (codePoint >= 0xdc00 && codePoint <= 0xdfff) {
                        return false;
                    }
                    appendCodePoint(output, codePoint);
                    break;
                }
                default:
                    return false;
            }
        }
        return false;
    }

    bool parseInteger(std::int64_t& value) {
        const std::size_t start = position_;
        if (position_ < input_.size() && input_[position_] == '-') {
            ++position_;
        }
        if (position_ >= input_.size()) {
            return false;
        }
        if (input_[position_] == '0') {
            ++position_;
            if (position_ < input_.size() &&
                input_[position_] >= '0' && input_[position_] <= '9') {
                return false;
            }
        } else {
            const std::size_t digitStart = position_;
            while (position_ < input_.size() &&
                   input_[position_] >= '0' && input_[position_] <= '9') {
                ++position_;
            }
            if (digitStart == position_) {
                return false;
            }
        }
        if (position_ < input_.size() &&
            (input_[position_] == '.' || input_[position_] == 'e' ||
             input_[position_] == 'E')) {
            return false;
        }

        const char* begin = input_.data() + start;
        const char* end = input_.data() + position_;
        const auto result = std::from_chars(begin, end, value);
        return result.ec == std::errc{} && result.ptr == end;
    }

    bool skipNumber() {
        const std::size_t start = position_;
        if (position_ < input_.size() && input_[position_] == '-') {
            ++position_;
        }
        if (position_ >= input_.size()) {
            return false;
        }
        if (input_[position_] == '0') {
            ++position_;
        } else if (input_[position_] >= '1' && input_[position_] <= '9') {
            while (position_ < input_.size() &&
                   input_[position_] >= '0' && input_[position_] <= '9') {
                ++position_;
            }
        } else {
            return false;
        }
        if (position_ < input_.size() && input_[position_] == '.') {
            ++position_;
            const std::size_t fractionStart = position_;
            while (position_ < input_.size() &&
                   input_[position_] >= '0' && input_[position_] <= '9') {
                ++position_;
            }
            if (fractionStart == position_) {
                return false;
            }
        }
        if (position_ < input_.size() &&
            (input_[position_] == 'e' || input_[position_] == 'E')) {
            ++position_;
            if (position_ < input_.size() &&
                (input_[position_] == '+' || input_[position_] == '-')) {
                ++position_;
            }
            const std::size_t exponentStart = position_;
            while (position_ < input_.size() &&
                   input_[position_] >= '0' && input_[position_] <= '9') {
                ++position_;
            }
            if (exponentStart == position_) {
                return false;
            }
        }
        return position_ > start;
    }

    bool skipLiteral(std::string_view literal) {
        if (input_.substr(position_, literal.size()) != literal) {
            return false;
        }
        position_ += literal.size();
        return true;
    }

    bool skipValue(int depth) {
        if (depth > 32 || position_ >= input_.size()) {
            return false;
        }
        if (input_[position_] == '"') {
            std::string ignored;
            return parseString(ignored);
        }
        if (input_[position_] == '{') {
            ++position_;
            skipWhitespace();
            if (consume('}')) {
                return true;
            }
            while (true) {
                std::string ignoredKey;
                if (!parseString(ignoredKey)) {
                    return false;
                }
                skipWhitespace();
                if (!consume(':')) {
                    return false;
                }
                skipWhitespace();
                if (!skipValue(depth + 1)) {
                    return false;
                }
                skipWhitespace();
                if (consume('}')) {
                    return true;
                }
                if (!consume(',')) {
                    return false;
                }
                skipWhitespace();
            }
        }
        if (input_[position_] == '[') {
            ++position_;
            skipWhitespace();
            if (consume(']')) {
                return true;
            }
            while (true) {
                if (!skipValue(depth + 1)) {
                    return false;
                }
                skipWhitespace();
                if (consume(']')) {
                    return true;
                }
                if (!consume(',')) {
                    return false;
                }
                skipWhitespace();
            }
        }
        if (input_[position_] == 't') {
            return skipLiteral("true");
        }
        if (input_[position_] == 'f') {
            return skipLiteral("false");
        }
        if (input_[position_] == 'n') {
            return skipLiteral("null");
        }
        return skipNumber();
    }

    void skipWhitespace() {
        while (position_ < input_.size()) {
            const char character = input_[position_];
            if (character != ' ' && character != '\t' &&
                character != '\r' && character != '\n') {
                break;
            }
            ++position_;
        }
    }

    std::string_view input_;
    std::size_t position_ = 0;
};

std::string jsonEscape(std::string_view value) {
    constexpr char kHex[] = "0123456789abcdef";
    std::string escaped;
    escaped.reserve(value.size() + 8);
    for (const unsigned char character : value) {
        switch (character) {
            case '"':
                escaped += "\\\"";
                break;
            case '\\':
                escaped += "\\\\";
                break;
            case '\b':
                escaped += "\\b";
                break;
            case '\f':
                escaped += "\\f";
                break;
            case '\n':
                escaped += "\\n";
                break;
            case '\r':
                escaped += "\\r";
                break;
            case '\t':
                escaped += "\\t";
                break;
            default:
                if (character < 0x20) {
                    escaped += "\\u00";
                    escaped.push_back(kHex[character >> 4]);
                    escaped.push_back(kHex[character & 0x0f]);
                } else {
                    escaped.push_back(static_cast<char>(character));
                }
                break;
        }
    }
    return escaped;
}

std::string wideToUtf8(std::wstring_view value) {
    if (value.empty()) {
        return {};
    }
    const int size = WideCharToMultiByte(
        CP_UTF8,
        WC_ERR_INVALID_CHARS,
        value.data(),
        static_cast<int>(value.size()),
        nullptr,
        0,
        nullptr,
        nullptr);
    if (size <= 0) {
        return {};
    }

    std::string result(static_cast<std::size_t>(size), '\0');
    if (WideCharToMultiByte(
            CP_UTF8,
            WC_ERR_INVALID_CHARS,
            value.data(),
            static_cast<int>(value.size()),
            result.data(),
            size,
            nullptr,
            nullptr) != size) {
        return {};
    }
    return result;
}

std::wstring utf8ToWide(std::string_view value) {
    if (value.empty()) {
        return {};
    }
    const int size = MultiByteToWideChar(
        CP_UTF8,
        MB_ERR_INVALID_CHARS,
        value.data(),
        static_cast<int>(value.size()),
        nullptr,
        0);
    if (size <= 0) {
        return {};
    }

    std::wstring result(static_cast<std::size_t>(size), L'\0');
    if (MultiByteToWideChar(
            CP_UTF8,
            MB_ERR_INVALID_CHARS,
            value.data(),
            static_cast<int>(value.size()),
            result.data(),
            size) != size) {
        return {};
    }
    return result;
}

bool caseInsensitiveContains(std::wstring_view value, std::wstring_view needle) {
    if (needle.empty() || needle.size() > value.size()) {
        return false;
    }
    for (std::size_t offset = 0; offset + needle.size() <= value.size(); ++offset) {
        if (CompareStringOrdinal(
                value.data() + offset,
                static_cast<int>(needle.size()),
                needle.data(),
                static_cast<int>(needle.size()),
                TRUE) == CSTR_EQUAL) {
            return true;
        }
    }
    return false;
}

void writeError(std::string_view error) {
    std::cout << "{\"ok\":false,\"error\":\"" << jsonEscape(error) << "\"}\n";
}

void enablePerMonitorDpiAwareness() {
    using SetProcessDpiAwarenessContextFunction = BOOL(WINAPI*)(HANDLE);
    const HMODULE user32 = GetModuleHandleW(L"user32.dll");
    if (user32 != nullptr) {
        const auto setContext = reinterpret_cast<SetProcessDpiAwarenessContextFunction>(
            GetProcAddress(user32, "SetProcessDpiAwarenessContext"));
        if (setContext != nullptr &&
            setContext(reinterpret_cast<HANDLE>(static_cast<std::intptr_t>(-4)))) {
            return;
        }
    }
    SetProcessDPIAware();
}

std::unordered_map<DWORD, DWORD> processParents() {
    std::unordered_map<DWORD, DWORD> parents;
    const HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot == INVALID_HANDLE_VALUE) {
        return parents;
    }

    PROCESSENTRY32W entry{};
    entry.dwSize = sizeof(entry);
    if (Process32FirstW(snapshot, &entry)) {
        do {
            parents.emplace(entry.th32ProcessID, entry.th32ParentProcessID);
        } while (Process32NextW(snapshot, &entry));
    }
    CloseHandle(snapshot);
    return parents;
}

std::vector<DWORD> processFamily(DWORD pid) {
    const auto parents = processParents();
    std::vector<DWORD> family;
    DWORD current = pid;
    while (current > 1 &&
           std::find(family.begin(), family.end(), current) == family.end()) {
        family.push_back(current);
        const auto parent = parents.find(current);
        if (parent == parents.end() || parent->second == 0) {
            break;
        }
        current = parent->second;
    }
    return family;
}

struct WindowCandidate {
    HWND handle = nullptr;
    DWORD pid = 0;
    RECT bounds{};
    std::size_t zOrder = 0;
    std::wstring title;
};

struct WindowEnumeration {
    std::vector<WindowCandidate> windows;
};

BOOL CALLBACK collectWindow(HWND window, LPARAM parameter) {
    auto& enumeration = *reinterpret_cast<WindowEnumeration*>(parameter);
    if (!IsWindowVisible(window) || GetWindow(window, GW_OWNER) != nullptr) {
        return TRUE;
    }

    RECT bounds{};
    if (!GetWindowRect(window, &bounds) ||
        bounds.right - bounds.left < 100 ||
        bounds.bottom - bounds.top < 100) {
        return TRUE;
    }

    DWORD pid = 0;
    GetWindowThreadProcessId(window, &pid);
    if (pid != 0) {
        const int titleLength = GetWindowTextLengthW(window);
        std::wstring title;
        if (titleLength > 0) {
            title.resize(static_cast<std::size_t>(titleLength) + 1);
            const int copied = GetWindowTextW(window, title.data(), titleLength + 1);
            title.resize(copied > 0 ? static_cast<std::size_t>(copied) : 0);
        }
        enumeration.windows.push_back(
            WindowCandidate{
                window,
                pid,
                bounds,
                enumeration.windows.size(),
                std::move(title)});
    }
    return TRUE;
}

bool findWindow(
    DWORD requestedPid,
    std::wstring_view titleHint,
    WindowCandidate& result) {
    const std::vector<DWORD> family = processFamily(requestedPid);
    if (family.empty()) {
        return false;
    }

    WindowEnumeration enumeration;
    if (!EnumWindows(collectWindow, reinterpret_cast<LPARAM>(&enumeration))) {
        return false;
    }

    HWND foreground = GetForegroundWindow();
    if (foreground != nullptr) {
        foreground = GetAncestor(foreground, GA_ROOT);
    }

    bool found = false;
    std::size_t bestTitleRank = 1;
    std::size_t bestForegroundRank = 1;
    std::size_t bestPidRank = std::numeric_limits<std::size_t>::max();
    std::size_t bestZOrder = std::numeric_limits<std::size_t>::max();
    for (const WindowCandidate& candidate : enumeration.windows) {
        const auto pidPosition =
            std::find(family.begin(), family.end(), candidate.pid);
        if (pidPosition == family.end()) {
            continue;
        }

        const std::size_t titleRank =
            caseInsensitiveContains(candidate.title, titleHint) ? 0 : 1;
        const std::size_t foregroundRank =
            candidate.handle == foreground ? 0 : 1;
        const std::size_t pidRank =
            static_cast<std::size_t>(std::distance(family.begin(), pidPosition));
        if (!found ||
            std::tie(titleRank, foregroundRank, pidRank, candidate.zOrder) <
                std::tie(
                    bestTitleRank,
                    bestForegroundRank,
                    bestPidRank,
                    bestZOrder)) {
            result = candidate;
            bestTitleRank = titleRank;
            bestForegroundRank = foregroundRank;
            bestPidRank = pidRank;
            bestZOrder = candidate.zOrder;
            found = true;
        }
    }
    return found;
}

struct DisplayDetails {
    RECT bounds{};
    std::wstring id;
    std::wstring name;
    double scaleFactor = 1.0;
};

bool monitorDevice(HMONITOR monitor, std::wstring& id, std::wstring& name) {
    MONITORINFOEXW monitorInfo{};
    monitorInfo.cbSize = sizeof(monitorInfo);
    if (!GetMonitorInfoW(monitor, &monitorInfo)) {
        return false;
    }

    for (DWORD adapterIndex = 0;; ++adapterIndex) {
        DISPLAY_DEVICEW adapter{};
        adapter.cb = sizeof(adapter);
        if (!EnumDisplayDevicesW(nullptr, adapterIndex, &adapter, 0)) {
            break;
        }
        if (_wcsicmp(adapter.DeviceName, monitorInfo.szDevice) != 0) {
            continue;
        }

        for (DWORD monitorIndex = 0;; ++monitorIndex) {
            DISPLAY_DEVICEW display{};
            display.cb = sizeof(display);
            if (!EnumDisplayDevicesW(
                    adapter.DeviceName,
                    monitorIndex,
                    &display,
                    EDD_GET_DEVICE_INTERFACE_NAME)) {
                break;
            }
            if ((display.StateFlags & DISPLAY_DEVICE_MIRRORING_DRIVER) != 0 ||
                display.DeviceID[0] == L'\0') {
                continue;
            }

            id = display.DeviceID;
            name = display.DeviceString;
            return true;
        }
        return false;
    }
    return false;
}

double monitorScaleFactor(HMONITOR monitor) {
    using GetDpiForMonitorFunction =
        HRESULT(WINAPI*)(HMONITOR, int, UINT*, UINT*);
    const HMODULE shcore = LoadLibraryW(L"shcore.dll");
    if (shcore == nullptr) {
        return 1.0;
    }

    const auto getDpi = reinterpret_cast<GetDpiForMonitorFunction>(
        GetProcAddress(shcore, "GetDpiForMonitor"));
    UINT dpiX = 96;
    UINT dpiY = 96;
    const bool succeeded =
        getDpi != nullptr && SUCCEEDED(getDpi(monitor, 0, &dpiX, &dpiY));
    FreeLibrary(shcore);
    return succeeded && dpiX > 0 ? static_cast<double>(dpiX) / 96.0 : 1.0;
}

bool displayForWindow(const RECT& window, DisplayDetails& result) {
    const POINT center{
        window.left + (window.right - window.left) / 2,
        window.top + (window.bottom - window.top) / 2};
    const HMONITOR monitor = MonitorFromPoint(center, MONITOR_DEFAULTTONULL);
    if (monitor == nullptr) {
        return false;
    }

    MONITORINFOEXW monitorInfo{};
    monitorInfo.cbSize = sizeof(monitorInfo);
    if (!GetMonitorInfoW(monitor, &monitorInfo) ||
        !monitorDevice(monitor, result.id, result.name)) {
        return false;
    }
    result.bounds = monitorInfo.rcMonitor;
    result.scaleFactor = monitorScaleFactor(monitor);
    return true;
}

void writeSuccess(
    const WindowCandidate& window,
    const DisplayDetails& display) {
    const std::string id = wideToUtf8(display.id);
    std::string name = wideToUtf8(display.name);
    if (id.empty()) {
        writeError("display_not_found");
        return;
    }
    if (name.empty()) {
        name = "Unknown Display";
    }

    std::cout
        << "{\"ok\":true,\"data\":{\"window\":{"
        << "\"x\":" << window.bounds.left
        << ",\"y\":" << window.bounds.top
        << ",\"width\":" << window.bounds.right - window.bounds.left
        << ",\"height\":" << window.bounds.bottom - window.bounds.top
        << "},\"display\":{"
        << "\"id\":\"" << jsonEscape(id)
        << "\",\"name\":\"" << jsonEscape(name)
        << "\",\"x\":" << display.bounds.left
        << ",\"y\":" << display.bounds.top
        << ",\"width\":" << display.bounds.right - display.bounds.left
        << ",\"height\":" << display.bounds.bottom - display.bounds.top
        << ",\"scaleFactor\":" << display.scaleFactor
        << "}}}\n";
}

}  // namespace

int main() {
    enablePerMonitorDpiAwareness();
    std::ios::sync_with_stdio(false);

    std::string input;
    while (std::getline(std::cin, input)) {
        Request request;
        RequestParser parser(input);
        if (!parser.parse(request)) {
            writeError("invalid_request");
            continue;
        }
        if (request.operation != kOperation) {
            writeError("unsupported_operation");
            continue;
        }
        if (request.pid <= 0 ||
            request.pid > std::numeric_limits<DWORD>::max()) {
            writeError("invalid_pid");
            continue;
        }

        WindowCandidate window;
        if (!findWindow(
                static_cast<DWORD>(request.pid),
                utf8ToWide(request.titleHint),
                window)) {
            writeError("window_not_found");
            continue;
        }

        DisplayDetails display;
        if (!displayForWindow(window.bounds, display)) {
            writeError("display_not_found");
            continue;
        }

        writeSuccess(window, display);
    }

    return 0;
}
