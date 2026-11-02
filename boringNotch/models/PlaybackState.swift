//
//  PlaybackState.swift
//  boringNotch
//
//  Created by Alexander on 2025-03-29.
//

import Foundation

enum RepeatMode: Int, Codable {
    case off = 1
    case one = 2
    case all = 3
}

struct PlaybackState {
    var bundleIdentifier: String
    var isPlaying: Bool = false
    var title: String = "I'm Handsome"
    var artist: String = "Me"
    var album: String = "Self Love"
    var currentTime: Double = 0
    var duration: Double = 0
    var playbackRate: Double = 1
    var isShuffled: Bool = false
    var repeatMode: RepeatMode = .off
    var lastUpdated: Date = Date.distantPast
    var artwork: Data?
    var volume: Double = 0.5
    var isFavorite: Bool = false
}

extension PlaybackState: Equatable {
    static func == (lhs: PlaybackState, rhs: PlaybackState) -> Bool {
        return lhs.bundleIdentifier == rhs.bundleIdentifier
            && lhs.isPlaying == rhs.isPlaying
            && lhs.title == rhs.title
            && lhs.artist == rhs.artist
            && lhs.album == rhs.album
            && lhs.currentTime == rhs.currentTime
            && lhs.duration == rhs.duration
            && lhs.isShuffled == rhs.isShuffled
            && lhs.repeatMode == rhs.repeatMode
            && lhs.artwork == rhs.artwork
            && lhs.isFavorite == rhs.isFavorite
    }
}

/// Source-aware filtering, independent of track duration or musical metadata.
/// Keep parent identity across diff-only updates from WebKit's GPU process.
struct NowPlayingSourcePolicy {
    private var bundle: String?
    private var parent: String?
    var sourceIdentifier: String { parent ?? bundle ?? "" }
    var isSuppressed: Bool { Self.isNotificationSource(sourceIdentifier) }
    var allowsCommands: Bool { !sourceIdentifier.isEmpty && !isSuppressed }

    mutating func observe(_ payload: NowPlayingPayload, isDiff: Bool) {
        if !isDiff { bundle = nil; parent = nil }
        if payload.bundleWasProvided {
            let next = Self.nonempty(payload.bundleIdentifier)
            if next != bundle { parent = nil }
            bundle = next
        }
        if payload.parentWasProvided { parent = Self.nonempty(payload.parentApplicationBundleIdentifier) }
    }

    private static func nonempty(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
        return value
    }

    static func isNotificationSource(_ identifier: String) -> Bool {
        let source = identifier.lowercased()
        let excluded = [
            "local.notch.chatdaemon", "local.huythai.boringnotch.chat",
            "net.whatsapp.whatsapp", "net.whatsapp.whatsappsmb",
            "com.facebook.archon", "com.facebook.messenger", "com.vng.zalo",
            "com.apple.notificationcenterui", "com.apple.usernotificationcenter",
            "com.apple.systemuiserver", "com.apple.controlcenter", "com.apple.systemsoundserverd"
        ]
        return excluded.contains { source == $0 || source.hasPrefix($0 + ".") }
    }
}

struct NowPlayingUpdate: Decodable {
    let payload: NowPlayingPayload
    let diff: Bool?
}

struct NowPlayingPayload: Decodable {
    let title: String?
    let artist: String?
    let album: String?
    let duration: Double?
    let elapsedTime: Double?
    let shuffleMode: Int?
    let repeatMode: Int?
    let artworkData: String?
    let timestamp: String?
    let playbackRate: Double?
    let playing: Bool?
    let parentApplicationBundleIdentifier: String?
    let bundleIdentifier: String?
    let volume: Double?
    let bundleWasProvided: Bool
    let parentWasProvided: Bool

    enum CodingKeys: String, CodingKey {
        case title, artist, album, duration, elapsedTime, shuffleMode, repeatMode
        case artworkData, timestamp, playbackRate, playing
        case parentApplicationBundleIdentifier, bundleIdentifier, volume
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        title = try c.decodeIfPresent(String.self, forKey: .title)
        artist = try c.decodeIfPresent(String.self, forKey: .artist)
        album = try c.decodeIfPresent(String.self, forKey: .album)
        duration = try c.decodeIfPresent(Double.self, forKey: .duration)
        elapsedTime = try c.decodeIfPresent(Double.self, forKey: .elapsedTime)
        shuffleMode = try c.decodeIfPresent(Int.self, forKey: .shuffleMode)
        repeatMode = try c.decodeIfPresent(Int.self, forKey: .repeatMode)
        artworkData = try c.decodeIfPresent(String.self, forKey: .artworkData)
        timestamp = try c.decodeIfPresent(String.self, forKey: .timestamp)
        playbackRate = try c.decodeIfPresent(Double.self, forKey: .playbackRate)
        playing = try c.decodeIfPresent(Bool.self, forKey: .playing)
        parentApplicationBundleIdentifier = try c.decodeIfPresent(String.self, forKey: .parentApplicationBundleIdentifier)
        bundleIdentifier = try c.decodeIfPresent(String.self, forKey: .bundleIdentifier)
        volume = try c.decodeIfPresent(Double.self, forKey: .volume)
        bundleWasProvided = c.contains(.bundleIdentifier)
        parentWasProvided = c.contains(.parentApplicationBundleIdentifier)
    }
}
