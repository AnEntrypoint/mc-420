import time

while True:
    fields = dict(line.split(':', 1) for line in open('/proc/meminfo').read().splitlines())
    print('mem available', fields['MemAvailable'].strip(), flush=True)
    time.sleep(20)
