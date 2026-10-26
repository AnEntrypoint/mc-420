#ifndef ALOOP_PHRASE_MESH_H
#define ALOOP_PHRASE_MESH_H

namespace aloop {

class PhraseMesh {
public:
    void start(bool enabled, int udpPort);
    void stop();
    bool tick(float localPhraseBeats, float& adoptedPhraseBeats);

private:
    void drain(double nowSeconds);
    void send(float beats);

    int sock_ = -1;
    int port_ = 0;
    unsigned nodeId_ = 0;
    float ownBeats_ = 0.0f;
    unsigned ownSeq_ = 0;
    double lastSendSeconds_ = -1.0;
    float peerBeats_ = 0.0f;
    unsigned peerSeq_ = 0;
    double peerSeenSeconds_ = -1.0;
    bool adopted_ = false;
    float adoptedBeats_ = 0.0f;
};

}
#endif
