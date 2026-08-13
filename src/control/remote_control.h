#ifndef ALOOP_REMOTE_CONTROL_H
#define ALOOP_REMOTE_CONTROL_H

#include <string>

namespace aloop {

class RemoteControl {
public:
    void start(int udpPort, const std::string& tokenOrEmptyToDisable);
    void stop();

    void poll();

private:
    std::string token_;
};

}
#endif
