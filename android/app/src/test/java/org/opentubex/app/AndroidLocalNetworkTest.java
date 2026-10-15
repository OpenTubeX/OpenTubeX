package org.opentubex.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import java.net.InetAddress;
import org.junit.Test;

public class AndroidLocalNetworkTest {
    @Test public void permissionCoversPrivateLinkLocalMulticastAndIpv6UniqueLocalAddresses() throws Exception {
        for (String host : new String[]{"10.0.2.2", "172.16.0.1", "192.168.1.1", "169.254.1.1",
            "239.255.255.250", "fe80::1", "fd12:3456::1", "fc00::1"}) {
            assertTrue(host, AndroidLocalNetworkPlugin.isLocalNetwork(InetAddress.getByName(host)));
        }
    }

    @Test public void publicAndLoopbackAddressesDoNotNeedLocalNetworkPermission() throws Exception {
        for (String host : new String[]{"127.0.0.1", "::1", "0.0.0.0", "::", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111"}) {
            assertFalse(host, AndroidLocalNetworkPlugin.isLocalNetwork(InetAddress.getByName(host)));
        }
    }
}
