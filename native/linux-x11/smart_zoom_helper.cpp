#include <X11/Xatom.h>
#include <X11/Xlib.h>
#include <X11/Xresource.h>
#include <X11/extensions/Xinerama.h>
#include <X11/extensions/Xrandr.h>

#include <algorithm>
#include <charconv>
#include <cctype>
#include <cstdint>
#include <cstdlib>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <optional>
#include <sstream>
#include <string>
#include <string_view>
#include <tuple>
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
    bool consume(char expected) {
        if (position_ >= input_.size() || input_[position_] != expected) {
            return false;
        }
        ++position_;
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
                case 'u':
                    if (!skipUnicodeEscape(output)) {
                        return false;
                    }
                    break;
                default:
                    return false;
            }
        }
        return false;
    }

    bool skipUnicodeEscape(std::string& output) {
        std::uint32_t codePoint = 0;
        if (!parseHexQuad(codePoint)) {
            return false;
        }
        if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
            if (!consume('\\') || !consume('u')) {
                return false;
            }
            std::uint32_t low = 0;
            if (!parseHexQuad(low) || low < 0xdc00 || low > 0xdfff) {
                return false;
            }
            codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (low - 0xdc00);
        } else if (codePoint >= 0xdc00 && codePoint <= 0xdfff) {
            return false;
        }
        appendCodePoint(output, codePoint);
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
                std::isdigit(static_cast<unsigned char>(input_[position_]))) {
                return false;
            }
        } else {
            const std::size_t digits = position_;
            while (position_ < input_.size() &&
                   std::isdigit(static_cast<unsigned char>(input_[position_]))) {
                ++position_;
            }
            if (digits == position_) {
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
                std::string ignored;
                if (!parseString(ignored)) {
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
        if (consumeLiteral("true") || consumeLiteral("false") ||
            consumeLiteral("null")) {
            return true;
        }
        return skipNumber();
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
                   std::isdigit(static_cast<unsigned char>(input_[position_]))) {
                ++position_;
            }
        } else {
            return false;
        }
        if (position_ < input_.size() && input_[position_] == '.') {
            ++position_;
            const std::size_t fraction = position_;
            while (position_ < input_.size() &&
                   std::isdigit(static_cast<unsigned char>(input_[position_]))) {
                ++position_;
            }
            if (fraction == position_) {
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
            const std::size_t exponent = position_;
            while (position_ < input_.size() &&
                   std::isdigit(static_cast<unsigned char>(input_[position_]))) {
                ++position_;
            }
            if (exponent == position_) {
                return false;
            }
        }
        return position_ > start;
    }

    bool consumeLiteral(std::string_view literal) {
        if (input_.substr(position_, literal.size()) != literal) {
            return false;
        }
        position_ += literal.size();
        return true;
    }

    void skipWhitespace() {
        while (position_ < input_.size() &&
               std::isspace(static_cast<unsigned char>(input_[position_]))) {
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

void writeError(std::string_view error) {
    std::cout << "{\"ok\":false,\"error\":\"" << jsonEscape(error) << "\"}\n";
}

bool isWaylandSession() {
    const char* sessionType = std::getenv("XDG_SESSION_TYPE");
    if (sessionType != nullptr) {
        std::string normalized(sessionType);
        std::transform(
            normalized.begin(),
            normalized.end(),
            normalized.begin(),
            [](unsigned char value) { return static_cast<char>(std::tolower(value)); });
        if (normalized == "wayland") {
            return true;
        }
    }
    const char* waylandDisplay = std::getenv("WAYLAND_DISPLAY");
    return waylandDisplay != nullptr && waylandDisplay[0] != '\0';
}

std::optional<std::int64_t> parentPid(std::int64_t pid) {
    std::ifstream stat("/proc/" + std::to_string(pid) + "/stat");
    std::string line;
    if (!std::getline(stat, line)) {
        return std::nullopt;
    }
    const std::size_t commandEnd = line.rfind(')');
    if (commandEnd == std::string::npos || commandEnd + 2 >= line.size()) {
        return std::nullopt;
    }

    std::istringstream fields(line.substr(commandEnd + 2));
    char state = '\0';
    std::int64_t result = 0;
    if (!(fields >> state >> result) || result <= 0) {
        return std::nullopt;
    }
    return result;
}

std::vector<std::int64_t> processFamily(std::int64_t pid) {
    std::vector<std::int64_t> family;
    while (pid > 1 && std::find(family.begin(), family.end(), pid) == family.end()) {
        family.push_back(pid);
        const auto parent = parentPid(pid);
        if (!parent.has_value()) {
            break;
        }
        pid = *parent;
    }
    return family;
}

std::optional<unsigned long> cardinalProperty(
    Display* display,
    Window window,
    Atom property) {
    Atom actualType = None;
    int actualFormat = 0;
    unsigned long itemCount = 0;
    unsigned long bytesAfter = 0;
    unsigned char* data = nullptr;
    const int status = XGetWindowProperty(
        display,
        window,
        property,
        0,
        1,
        False,
        XA_CARDINAL,
        &actualType,
        &actualFormat,
        &itemCount,
        &bytesAfter,
        &data);
    if (status != Success || actualType != XA_CARDINAL || actualFormat != 32 ||
        itemCount != 1 || data == nullptr) {
        if (data != nullptr) {
            XFree(data);
        }
        return std::nullopt;
    }

    const unsigned long value = *reinterpret_cast<unsigned long*>(data);
    XFree(data);
    return value;
}

std::string windowTitle(Display* display, Window window) {
    const Atom titleAtom = XInternAtom(display, "_NET_WM_NAME", True);
    if (titleAtom != None) {
        Atom actualType = None;
        int actualFormat = 0;
        unsigned long itemCount = 0;
        unsigned long bytesAfter = 0;
        unsigned char* data = nullptr;
        if (XGetWindowProperty(
                display,
                window,
                titleAtom,
                0,
                1024 * 1024,
                False,
                AnyPropertyType,
                &actualType,
                &actualFormat,
                &itemCount,
                &bytesAfter,
                &data) == Success &&
            actualType != None && actualFormat == 8 && data != nullptr) {
            std::string result(
                reinterpret_cast<const char*>(data),
                static_cast<std::size_t>(itemCount));
            XFree(data);
            return result;
        }
        if (data != nullptr) {
            XFree(data);
        }
    }

    char* legacyTitle = nullptr;
    if (XFetchName(display, window, &legacyTitle) && legacyTitle != nullptr) {
        std::string result(legacyTitle);
        XFree(legacyTitle);
        return result;
    }
    return {};
}

bool caseInsensitiveContains(std::string_view value, std::string_view needle) {
    if (needle.empty() || needle.size() > value.size()) {
        return false;
    }
    const auto equalIgnoringCase = [](char lhs, char rhs) {
        return std::tolower(static_cast<unsigned char>(lhs)) ==
            std::tolower(static_cast<unsigned char>(rhs));
    };
    return std::search(
               value.begin(),
               value.end(),
               needle.begin(),
               needle.end(),
               equalIgnoringCase) != value.end();
}

std::vector<Window> windowList(Display* display, Window root) {
    const Atom stacking = XInternAtom(display, "_NET_CLIENT_LIST_STACKING", True);
    if (stacking != None) {
        Atom actualType = None;
        int actualFormat = 0;
        unsigned long itemCount = 0;
        unsigned long bytesAfter = 0;
        unsigned char* data = nullptr;
        if (XGetWindowProperty(
                display,
                root,
                stacking,
                0,
                1024 * 1024,
                False,
                XA_WINDOW,
                &actualType,
                &actualFormat,
                &itemCount,
                &bytesAfter,
                &data) == Success &&
            actualType == XA_WINDOW && actualFormat == 32 && data != nullptr) {
            const Window* windows = reinterpret_cast<Window*>(data);
            std::vector<Window> result(windows, windows + itemCount);
            XFree(data);
            std::reverse(result.begin(), result.end());
            return result;
        }
        if (data != nullptr) {
            XFree(data);
        }
    }

    Window ignoredRoot = None;
    Window ignoredParent = None;
    Window* children = nullptr;
    unsigned int childCount = 0;
    if (!XQueryTree(
            display,
            root,
            &ignoredRoot,
            &ignoredParent,
            &children,
            &childCount)) {
        return {};
    }
    std::vector<Window> result(children, children + childCount);
    if (children != nullptr) {
        XFree(children);
    }
    std::reverse(result.begin(), result.end());
    return result;
}

Window activeWindow(Display* display, Window root) {
    const Atom active = XInternAtom(display, "_NET_ACTIVE_WINDOW", True);
    if (active == None) {
        return None;
    }

    Atom actualType = None;
    int actualFormat = 0;
    unsigned long itemCount = 0;
    unsigned long bytesAfter = 0;
    unsigned char* data = nullptr;
    if (XGetWindowProperty(
            display,
            root,
            active,
            0,
            1,
            False,
            XA_WINDOW,
            &actualType,
            &actualFormat,
            &itemCount,
            &bytesAfter,
            &data) != Success ||
        actualType != XA_WINDOW || actualFormat != 32 || itemCount != 1 ||
        data == nullptr) {
        if (data != nullptr) {
            XFree(data);
        }
        return None;
    }
    const Window result = *reinterpret_cast<Window*>(data);
    XFree(data);
    return result;
}

struct Bounds {
    int x = 0;
    int y = 0;
    int width = 0;
    int height = 0;
};

struct WindowCandidate {
    Window handle = None;
    std::int64_t pid = 0;
    Bounds bounds;
    std::size_t zOrder = 0;
    std::string title;
};

std::optional<WindowCandidate> windowCandidate(
    Display* display,
    Window root,
    Window window,
    Atom pidAtom,
    std::size_t zOrder) {
    const auto pid = cardinalProperty(display, window, pidAtom);
    if (!pid.has_value()) {
        return std::nullopt;
    }

    XWindowAttributes attributes{};
    if (!XGetWindowAttributes(display, window, &attributes) ||
        attributes.map_state != IsViewable ||
        attributes.width < 100 || attributes.height < 100) {
        return std::nullopt;
    }

    int rootX = 0;
    int rootY = 0;
    Window child = None;
    if (!XTranslateCoordinates(
            display,
            window,
            root,
            0,
            0,
            &rootX,
            &rootY,
            &child)) {
        return std::nullopt;
    }

    return WindowCandidate{
        window,
        static_cast<std::int64_t>(*pid),
        Bounds{rootX, rootY, attributes.width, attributes.height},
        zOrder,
        windowTitle(display, window)};
}

bool findWindow(
    Display* display,
    Window root,
    std::int64_t requestedPid,
    std::string_view titleHint,
    WindowCandidate& result) {
    const std::vector<std::int64_t> family = processFamily(requestedPid);
    if (family.empty()) {
        return false;
    }

    const Atom pidAtom = XInternAtom(display, "_NET_WM_PID", True);
    if (pidAtom == None) {
        return false;
    }
    const Window foreground = activeWindow(display, root);

    bool found = false;
    std::tuple<int, int, std::size_t, std::size_t> bestRank;
    const std::vector<Window> windows = windowList(display, root);
    for (std::size_t index = 0; index < windows.size(); ++index) {
        const auto candidate =
            windowCandidate(display, root, windows[index], pidAtom, index);
        if (!candidate.has_value()) {
            continue;
        }
        const auto familyPosition =
            std::find(family.begin(), family.end(), candidate->pid);
        if (familyPosition == family.end()) {
            continue;
        }

        const auto rank = std::make_tuple(
            caseInsensitiveContains(candidate->title, titleHint) ? 0 : 1,
            candidate->handle == foreground ? 0 : 1,
            static_cast<std::size_t>(std::distance(family.begin(), familyPosition)),
            candidate->zOrder);
        if (!found || rank < bestRank) {
            result = *candidate;
            bestRank = rank;
            found = true;
        }
    }
    return found;
}

double displayScaleFactor(Display* display) {
    XrmInitialize();
    const char* resources = XResourceManagerString(display);
    if (resources != nullptr) {
        XrmDatabase database = XrmGetStringDatabase(resources);
        if (database != nullptr) {
            char* type = nullptr;
            XrmValue value{};
            if (XrmGetResource(database, "Xft.dpi", "Xft.Dpi", &type, &value) &&
                value.addr != nullptr) {
                char* end = nullptr;
                const double dpi = std::strtod(value.addr, &end);
                XrmDestroyDatabase(database);
                if (end != value.addr && dpi > 0) {
                    return dpi / 96.0;
                }
            } else {
                XrmDestroyDatabase(database);
            }
        }
    }

    const char* gdkScale = std::getenv("GDK_SCALE");
    if (gdkScale != nullptr) {
        char* end = nullptr;
        const double scale = std::strtod(gdkScale, &end);
        if (end != gdkScale && scale > 0) {
            return scale;
        }
    }
    return 1.0;
}

std::string atomName(Display* display, Atom atom) {
    if (atom == None) {
        return {};
    }
    char* value = XGetAtomName(display, atom);
    if (value == nullptr) {
        return {};
    }
    std::string result(value);
    XFree(value);
    return result;
}

std::string edidIdentifier(Display* display, RROutput output) {
    const Atom edid = XInternAtom(display, "EDID", True);
    if (edid == None) {
        return {};
    }

    Atom actualType = None;
    int actualFormat = 0;
    unsigned long itemCount = 0;
    unsigned long bytesAfter = 0;
    unsigned char* data = nullptr;
    if (XRRGetOutputProperty(
            display,
            output,
            edid,
            0,
            1024,
            False,
            False,
            AnyPropertyType,
            &actualType,
            &actualFormat,
            &itemCount,
            &bytesAfter,
            &data) != Success ||
        actualType == None || actualFormat != 8 || itemCount < 16 || data == nullptr) {
        if (data != nullptr) {
            XFree(data);
        }
        return {};
    }

    std::uint64_t hash = 14695981039346656037ULL;
    for (unsigned long index = 0; index < itemCount; ++index) {
        hash ^= data[index];
        hash *= 1099511628211ULL;
    }
    XFree(data);

    std::ostringstream identifier;
    identifier << "edid-" << std::hex << std::setfill('0') << std::setw(16) << hash;
    return identifier.str();
}

struct DisplayDetails {
    Bounds bounds;
    std::string id;
    std::string name;
    double scaleFactor = 1.0;
};

bool contains(const Bounds& bounds, int x, int y) {
    return x >= bounds.x && x < bounds.x + bounds.width &&
        y >= bounds.y && y < bounds.y + bounds.height;
}

bool displayFromRandr(
    Display* display,
    Window root,
    int centerX,
    int centerY,
    double scaleFactor,
    DisplayDetails& result) {
    int eventBase = 0;
    int errorBase = 0;
    if (!XRRQueryExtension(display, &eventBase, &errorBase)) {
        return false;
    }

    int monitorCount = 0;
    XRRMonitorInfo* monitors = XRRGetMonitors(display, root, True, &monitorCount);
    if (monitors == nullptr) {
        return false;
    }
    XRRScreenResources* resources = XRRGetScreenResourcesCurrent(display, root);

    bool found = false;
    for (int index = 0; index < monitorCount && !found; ++index) {
        const XRRMonitorInfo& monitor = monitors[index];
        const Bounds bounds{
            monitor.x,
            monitor.y,
            static_cast<int>(monitor.width),
            static_cast<int>(monitor.height)};
        if (!contains(bounds, centerX, centerY)) {
            continue;
        }

        std::string monitorName = atomName(display, monitor.name);
        std::string outputName;
        std::string identifier;
        if (resources != nullptr) {
            for (int outputIndex = 0; outputIndex < monitor.noutput; ++outputIndex) {
                XRROutputInfo* output =
                    XRRGetOutputInfo(display, resources, monitor.outputs[outputIndex]);
                if (output == nullptr) {
                    continue;
                }
                if (output->connection == RR_Connected) {
                    outputName.assign(output->name, output->nameLen);
                    identifier =
                        edidIdentifier(display, monitor.outputs[outputIndex]);
                    XRRFreeOutputInfo(output);
                    break;
                }
                XRRFreeOutputInfo(output);
            }
        }

        if (outputName.empty()) {
            outputName = monitorName;
        }
        if (outputName.empty()) {
            outputName = "Unknown Display";
        }
        if (identifier.empty()) {
            identifier = "xrandr:" + outputName;
        }

        result = DisplayDetails{
            bounds,
            std::move(identifier),
            std::move(outputName),
            scaleFactor};
        found = true;
    }

    if (resources != nullptr) {
        XRRFreeScreenResources(resources);
    }
    XRRFreeMonitors(monitors);
    return found;
}

bool displayFromXinerama(
    Display* display,
    int centerX,
    int centerY,
    double scaleFactor,
    DisplayDetails& result) {
    int eventBase = 0;
    int errorBase = 0;
    if (!XineramaQueryExtension(display, &eventBase, &errorBase) ||
        !XineramaIsActive(display)) {
        return false;
    }

    int screenCount = 0;
    XineramaScreenInfo* screens = XineramaQueryScreens(display, &screenCount);
    if (screens == nullptr) {
        return false;
    }

    bool found = false;
    for (int index = 0; index < screenCount; ++index) {
        const Bounds bounds{
            screens[index].x_org,
            screens[index].y_org,
            screens[index].width,
            screens[index].height};
        if (!contains(bounds, centerX, centerY)) {
            continue;
        }
        const std::string suffix = std::to_string(screens[index].screen_number);
        result = DisplayDetails{
            bounds,
            "xinerama:" + suffix,
            "Xinerama Screen " + suffix,
            scaleFactor};
        found = true;
        break;
    }
    XFree(screens);
    return found;
}

bool displayForWindow(
    Display* display,
    Window root,
    const Bounds& window,
    DisplayDetails& result) {
    const int centerX = window.x + window.width / 2;
    const int centerY = window.y + window.height / 2;
    const double scaleFactor = displayScaleFactor(display);
    return displayFromRandr(
               display,
               root,
               centerX,
               centerY,
               scaleFactor,
               result) ||
        displayFromXinerama(
               display,
               centerX,
               centerY,
               scaleFactor,
               result);
}

void writeSuccess(
    const WindowCandidate& window,
    const DisplayDetails& display) {
    std::cout
        << "{\"ok\":true,\"data\":{\"window\":{"
        << "\"x\":" << window.bounds.x
        << ",\"y\":" << window.bounds.y
        << ",\"width\":" << window.bounds.width
        << ",\"height\":" << window.bounds.height
        << "},\"display\":{"
        << "\"id\":\"" << jsonEscape(display.id)
        << "\",\"name\":\"" << jsonEscape(display.name)
        << "\",\"x\":" << display.bounds.x
        << ",\"y\":" << display.bounds.y
        << ",\"width\":" << display.bounds.width
        << ",\"height\":" << display.bounds.height
        << ",\"scaleFactor\":" << display.scaleFactor
        << "}}}\n";
}

}  // namespace

int main() {
    std::ios::sync_with_stdio(false);

    std::string input;
    if (!std::getline(std::cin, input)) {
        writeError("invalid_request");
        return EXIT_SUCCESS;
    }

    Request request;
    RequestParser parser(input);
    if (!parser.parse(request)) {
        writeError("invalid_request");
        return EXIT_SUCCESS;
    }
    if (request.operation != kOperation) {
        writeError("unsupported_operation");
        return EXIT_SUCCESS;
    }
    if (request.pid <= 0 ||
        request.pid > std::numeric_limits<std::int32_t>::max()) {
        writeError("invalid_pid");
        return EXIT_SUCCESS;
    }
    if (isWaylandSession()) {
        writeError("wayland_unsupported");
        return EXIT_SUCCESS;
    }

    Display* display = XOpenDisplay(nullptr);
    if (display == nullptr) {
        writeError("x11_unavailable");
        return EXIT_SUCCESS;
    }
    const Window root = DefaultRootWindow(display);

    WindowCandidate window;
    if (!findWindow(display, root, request.pid, request.titleHint, window)) {
        XCloseDisplay(display);
        writeError("window_not_found");
        return EXIT_SUCCESS;
    }

    DisplayDetails displayDetails;
    if (!displayForWindow(display, root, window.bounds, displayDetails)) {
        XCloseDisplay(display);
        writeError("display_not_found");
        return EXIT_SUCCESS;
    }

    XCloseDisplay(display);
    writeSuccess(window, displayDetails);
    return EXIT_SUCCESS;
}
