//go:build casttestroot

package main

import "encoding/base64"

// The Android receiver integration test builds the sender with this tag and a
// temporary root of its own, so that an open source receiver holding a device
// certificate from that root can authenticate. Other builds never set the tag,
// so they contain neither this code nor a way to add a root.
//
// Set with -ldflags=-X main.castTestRoot=<base64 PEM>, see androidCastSender.mjs.
var castTestRoot string

func init() {
	root, err := base64.StdEncoding.DecodeString(castTestRoot)
	if err != nil || len(root) == 0 {
		panic("casttestroot build without a test root")
	}
	castRootPEM = append(append(append([]byte{}, castRootPEM...), '\n'), root...)
}
