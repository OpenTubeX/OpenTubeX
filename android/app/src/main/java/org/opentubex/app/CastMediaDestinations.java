package org.opentubex.app;

import java.io.IOException;
import java.net.InetAddress;
import java.net.Proxy;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import okhttp3.Dns;
import okhttp3.HttpUrl;
import okhttp3.Interceptor;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/** Cast sources cannot grant access to local services, including through DNS or redirects. */
final class CastMediaDestinations implements Interceptor {
    // Keep these ranges aligned with isNonPublicNetworkAddress in src/main/utils.js.
    private static final String[] NON_PUBLIC = {
        "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16",
        "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24", "192.168.0.0/16", "198.18.0.0/15",
        "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4",
        "::/128", "::1/128", "64:ff9b::/96", "64:ff9b:1::/48", "100::/64", "2001:2::/48",
        "2001:10::/28", "2001:db8::/32", "2002::/16", "fc00::/7", "fe80::/10", "fec0::/10", "ff00::/8"
    };
    private record Subnet(byte[] address, int prefix) {}
    private static final List<Subnet> SUBNETS = subnets();

    private static List<Subnet> subnets() {
        var result = new ArrayList<Subnet>();
        try {
            for (String cidr : NON_PUBLIC) {
                String[] parts = cidr.split("/");
                result.add(new Subnet(InetAddress.getByName(parts[0]).getAddress(), Integer.parseInt(parts[1])));
            }
        } catch (UnknownHostException error) { throw new ExceptionInInitializerError(error); }
        return result;
    }

    static boolean isPublic(InetAddress address) {
        byte[] bytes = address.getAddress();
        for (Subnet subnet : SUBNETS) {
            if (bytes.length != subnet.address().length) continue;
            int remaining = subnet.prefix();
            boolean matches = true;
            for (int index = 0; remaining > 0; index++, remaining -= 8) {
                int mask = (0xff << Math.max(0, 8 - remaining)) & 0xff;
                if ((bytes[index] & mask) != (subnet.address()[index] & mask)) { matches = false; break; }
            }
            if (matches) return false;
        }
        return true;
    }

    static Dns publicDns(Dns resolver) {
        return host -> {
            List<InetAddress> addresses = new ArrayList<>(resolver.lookup(host));
            if (addresses.isEmpty()) throw new UnknownHostException("Empty Cast destination");
            for (InetAddress address : addresses) {
                if (!isPublic(address)) throw new UnknownHostException("Non-public Cast destination");
            }
            // OkHttp connects to these exact validated addresses, without resolving again.
            return addresses;
        };
    }

    static void validate(HttpUrl url) throws IOException {
        if (!url.username().isEmpty() || !url.password().isEmpty()) throw new IOException("Invalid Cast destination");
        String host = url.host();
        // OkHttp bypasses Dns for IP literals, so validate those before opening a socket.
        if (host.contains(":") || host.matches("[0-9.]+")) {
            if (host.contains("%") || !isPublic(InetAddress.getByName(host))) throw new IOException("Non-public Cast destination");
        }
    }

    static OkHttpClient restrict(OkHttpClient client) {
        var builder = client.newBuilder().proxy(Proxy.NO_PROXY).dns(publicDns(client.dns()))
            .followRedirects(false).followSslRedirects(false);
        builder.interceptors().add(0, new CastMediaDestinations());
        return builder.build();
    }

    @Override public Response intercept(Chain chain) throws IOException {
        Request request = chain.request();
        for (int redirects = 0; ; redirects++) {
            validate(request.url());
            Response response = chain.proceed(request);
            String location = response.header("Location");
            if (!Set.of(301, 302, 303, 307, 308).contains(response.code()) || location == null) return response;
            HttpUrl next = request.url().resolve(location);
            response.close();
            if (redirects >= 5 || next == null) throw new IOException("Invalid Cast redirect");
            request = request.newBuilder().url(next).build();
        }
    }
}
