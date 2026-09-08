"""SPILL THE LETTERS - local server.

Serves the game over HTTPS (phones need a secure page for WebRTC) and plain
HTTP for the laptop. Print the LAN address, open the HTTPS one on the projector
laptop, and everyone else scans the QR code on screen.

    python serve.py        ->  https://<LAN IP>:4245   and   http://localhost:4246

The certificate is self-signed, so each phone taps Advanced / Show details ->
continue once. For a real event use the GitHub Pages URL instead, which has a
trusted certificate and no warning:  https://qwendor.github.io/spillletters/
"""
import http.server, ssl, socket, threading, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
HTTPS_PORT = int(os.environ.get('SPILL_HTTPS', 4245))
HTTP_PORT = int(os.environ.get('SPILL_HTTP', 4246))


def lan_ips():
    ips = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ips.append(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    try:
        for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
            if ip not in ips and not ip.startswith('127.'):
                ips.append(ip)
    except Exception:
        pass
    return ips or ['127.0.0.1']


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=HERE, **k)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def run_http():
    Server(('0.0.0.0', HTTP_PORT), Handler).serve_forever()


def main():
    cert = os.path.join(HERE, 'cert.pem')
    key = os.path.join(HERE, 'key.pem')
    ips = lan_ips()
    threading.Thread(target=run_http, daemon=True).start()

    print('SPILL THE LETTERS is running.')
    print('  Big screen  :  http://localhost:%d/?host=1' % HTTP_PORT)
    if os.path.exists(cert) and os.path.exists(key):
        print('  Phones      :  https://%s:%d/' % (ips[0], HTTPS_PORT))
        print('  The certificate is self-signed: on each phone tap Advanced -> continue (once).')
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(cert, key)
        httpsd = Server(('0.0.0.0', HTTPS_PORT), Handler)
        httpsd.socket = ctx.wrap_socket(httpsd.socket, server_side=True)
        sys.stdout.flush()
        try:
            httpsd.serve_forever()
        except KeyboardInterrupt:
            pass
    else:
        print('  No cert.pem / key.pem found, HTTP only on port %d.' % HTTP_PORT)
        sys.stdout.flush()
        try:
            threading.Event().wait()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
