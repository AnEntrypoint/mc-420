#ifndef ALOOP_JSON_NUMBER_H
#define ALOOP_JSON_NUMBER_H

#include <cctype>
#include <cstddef>

namespace aloop {

namespace json_detail {

inline bool tokenAt(const char* s, size_t n, size_t at, const char* token) {
    size_t len = 0;
    while (token[len]) len++;
    if (at + len > n) return false;
    for (size_t k = 0; k < len; k++) {
        if (std::tolower(static_cast<unsigned char>(s[at + k])) != static_cast<unsigned char>(token[k])) return false;
    }
    return true;
}

inline size_t tokenLength(const char* token) {
    size_t len = 0;
    while (token[len]) len++;
    return len;
}

}

inline size_t sanitizeJsonNonFinite(const char* in, size_t n, char* out, size_t cap) {
    static const char* const kTokens[] = {"-nan", "nan", "-inf", "inf"};
    size_t o = 0;
    size_t i = 0;
    while (i < n) {
        bool replaced = false;
        const bool valueStart = i > 0 && (in[i - 1] == '[' || in[i - 1] == ',' || in[i - 1] == ':');
        if (valueStart) {
            for (const char* token : kTokens) {
                const size_t end = i + json_detail::tokenLength(token);
                const bool boundedAfter = end == n || in[end] == ',' || in[end] == ']' || in[end] == '}';
                if (!boundedAfter || !json_detail::tokenAt(in, n, i, token)) continue;
                if (o + 4 >= cap) return 0;
                out[o++] = 'n';
                out[o++] = 'u';
                out[o++] = 'l';
                out[o++] = 'l';
                i = end;
                replaced = true;
                break;
            }
        }
        if (!replaced) {
            if (o + 1 >= cap) return 0;
            out[o++] = in[i++];
        }
    }
    if (o >= cap) return 0;
    out[o] = 0;
    return o;
}

}

#endif
