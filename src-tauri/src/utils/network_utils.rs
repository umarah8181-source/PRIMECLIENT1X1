use std::net::TcpStream;
use std::time::Duration;

/// Check if the network is available by pinging public DNS servers.
pub fn is_network_available() -> bool {
    let addrs = [
        "1.1.1.1:53",
        "8.8.8.8:53",
        "208.67.222.222:53",
    ];
    for addr in &addrs {
        if let Ok(addr_parsed) = addr.parse() {
            if TcpStream::connect_timeout(&addr_parsed, Duration::from_millis(300)).is_ok() {
                return true;
            }
        }
    }
    false
}
