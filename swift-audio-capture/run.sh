#!/bin/bash

# Audio Capture Tool Runner Script
# This script builds and runs the Swift audio capture tool

set -e

echo "🎵 Interview Terminator - Audio Capture Tool"
echo "==========================================="

# Check if we're in the right directory
if [ ! -f "Package.swift" ]; then
    echo "❌ Error: Package.swift not found. Please run this script from the swift-audio-capture directory."
    exit 1
fi

# Check macOS version
macos_version=$(sw_vers -productVersion)
macos_major=$(echo $macos_version | cut -d. -f1)
macos_minor=$(echo $macos_version | cut -d. -f2)

if [ "$macos_major" -lt 12 ] || ([ "$macos_major" -eq 12 ] && [ "$macos_minor" -lt 3 ]); then
    echo "❌ Error: This tool requires macOS 12.3 or later. Current version: $macos_version"
    exit 1
fi

echo "✅ macOS version check passed: $macos_version"

# Build the project
echo "🔨 Building Swift package..."
swift build

if [ $? -eq 0 ]; then
    echo "✅ Build successful"
else
    echo "❌ Build failed"
    exit 1
fi

# Check for required permissions
echo "🔐 Checking permissions..."
echo "   Make sure you have granted:"
echo "   - Microphone access"
echo "   - Screen Recording permission (for system audio capture)"
echo ""

# Run the tool
echo "🚀 Starting audio capture..."
echo "   Press Ctrl+C to stop"
echo ""

swift run AudioCapture