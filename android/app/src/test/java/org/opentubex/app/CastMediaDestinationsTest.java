package org.opentubex.app;

import static org.junit.Assert.*;
import java.io.IOException;
import java.net.InetAddress;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import okhttp3.Dns;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.junit.Test;

public class CastMediaDestinationsTest {
    @Test public void deniesPrivateReservedAndMappedAddresses() throws Exception {
        for (String host : new String[]{"0.0.0.1", "10.0.0.1", "100.64.0.1", "100.127.255.255", "127.0.0.1", "169.254.1.1",
            "172.16.0.1", "172.31.255.255", "192.0.0.1", "192.0.2.1", "192.168.0.1", "198.18.0.1", "198.19.255.255",
            "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255", "::", "::1", "::ffff:127.0.0.1",
            "64:ff9b::7f00:1", "64:ff9b:1::1", "100::1", "2001:2::1", "2001:10::1", "2001:1f::1", "2001:db8::1",
            "2002:7f00:1::", "fc00::1", "fdff::1", "fe80::1", "febf::1", "fec0::1", "ff02::1"}) {
            assertFalse(host, CastMediaDestinations.isPublic(InetAddress.getByName(host)));
            try { CastMediaDestinations.validate(HttpUrl.get("http://" + (host.contains(":") ? "[" + host + "]" : host) + "/")); fail(host); }
            catch (IOException expected) {}
        }
    }

    @Test public void acceptsPublicAddressesAtSubnetBoundaries() throws Exception {
        for (String host : new String[]{"8.8.8.8", "100.63.255.255", "100.128.0.0", "172.15.255.255", "172.32.0.0",
            "192.0.1.1", "198.17.255.255", "198.20.0.0", "2001:4860:4860::8888", "::ffff:8.8.8.8", "2001:20::1"}) {
            assertTrue(host, CastMediaDestinations.isPublic(InetAddress.getByName(host)));
        }
    }

    @Test public void rejectsEmbeddedCredentials() throws Exception {
        try { CastMediaDestinations.validate(HttpUrl.get("https://user:password@example.com/")); fail(); }
        catch (IOException expected) {}
    }

    @Test public void validatesEveryDnsAnswerAndReturnsOnlyPinnedPublicAddresses() throws Exception {
        List<InetAddress> publicAddresses = List.of(InetAddress.getByName("8.8.8.8"), InetAddress.getByName("2001:4860:4860::8888"));
        assertEquals(publicAddresses, CastMediaDestinations.publicDns(host -> publicAddresses).lookup("media.example"));
        for (List<InetAddress> addresses : List.of(List.<InetAddress>of(),
            List.of(publicAddresses.get(0), InetAddress.getByName("127.0.0.1")),
            List.of(InetAddress.getByName("192.168.1.1"), publicAddresses.get(0)))) {
            try { CastMediaDestinations.publicDns(host -> addresses).lookup("media.example"); fail("Unsafe DNS answer accepted"); }
            catch (java.net.UnknownHostException expected) {}
        }
    }

    @Test public void rejectsDnsRebindingOnNewConnections() throws Exception {
        AtomicInteger lookups = new AtomicInteger();
        Dns dns = CastMediaDestinations.publicDns(host -> List.of(InetAddress.getByName(lookups.getAndIncrement() == 0 ? "8.8.8.8" : "127.0.0.1")));
        assertEquals("8.8.8.8", dns.lookup("media.example").get(0).getHostAddress());
        try { dns.lookup("media.example"); fail("Rebound destination accepted"); }
        catch (java.net.UnknownHostException expected) {}
    }

    @Test public void validatesRedirectTargetsBeforeIssuingRequests() throws Exception {
        for (String target : new String[]{"http://127.0.0.1/private", "http://192.168.1.1/private", "http://[::1]/private", "http://user:password@example.com/"}) {
            List<String> requested = new ArrayList<>();
            OkHttpClient client = CastMediaDestinations.restrict(new OkHttpClient.Builder().addInterceptor(chain -> {
                requested.add(chain.request().url().toString());
                return response(chain.request(), 302).newBuilder().header("Location", target).build();
            }).build());
            try (Response ignored = client.newCall(new Request.Builder().url("https://8.8.8.8/media").build()).execute()) {
                fail("Unsafe redirect accepted");
            } catch (IOException expected) {}
            assertEquals(List.of("https://8.8.8.8/media"), requested);
        }
    }

    @Test public void preservesRangeAndOriginalCredentialScopeThroughPublicRedirects() throws Exception {
        List<Request> requested = new ArrayList<>();
        OkHttpClient client = CastMediaDestinations.restrict(new OkHttpClient.Builder().addInterceptor(chain -> {
            requested.add(chain.request());
            return requested.size() == 1 ? response(chain.request(), 307).newBuilder().header("Location", "https://1.1.1.1/next").build()
                : response(chain.request(), 200);
        }).build());
        HttpUrl original = HttpUrl.get("https://8.8.8.8/media");
        try (Response result = client.newCall(new Request.Builder().url(original).tag(HttpUrl.class, original)
            .header("Range", "bytes=100-").method("HEAD", null).build()).execute()) {
            assertEquals(200, result.code());
            assertEquals("https://1.1.1.1/next", result.request().url().toString());
        }
        assertEquals(2, requested.size());
        assertEquals("HEAD", requested.get(1).method());
        assertEquals("bytes=100-", requested.get(1).header("Range"));
        assertEquals(original, requested.get(1).tag(HttpUrl.class));
    }

    @Test public void limitsRedirectLoops() throws Exception {
        AtomicInteger requests = new AtomicInteger();
        OkHttpClient client = CastMediaDestinations.restrict(new OkHttpClient.Builder().addInterceptor(chain -> {
            requests.incrementAndGet();
            return response(chain.request(), 302).newBuilder().header("Location", "/loop").build();
        }).build());
        try (Response ignored = client.newCall(new Request.Builder().url("https://8.8.8.8/media").build()).execute()) { fail(); }
        catch (IOException expected) { assertEquals(6, requests.get()); }
    }

    private static Response response(Request request, int code) {
        return new Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(code).message("fixture")
            .body(ResponseBody.create("", MediaType.get("video/mp4"))).build();
    }
}
