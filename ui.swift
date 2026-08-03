// ui.swift — native macOS front-end for chrome-to-safari.sh
// Compiled on first run by `./chrome-to-safari.sh --ui` (swiftc, no Xcode project).
// The shell script stays the single source of truth; this window just runs it
// and shows its output.

import SwiftUI
import UniformTypeIdentifiers

enum ConversionMode: String, CaseIterable, Identifiable {
    case convert = "Convert"
    case buildOnly = "Build Only"
    case installOnly = "Install Only"

    var id: String { rawValue }
}

struct Step: Identifiable {
    let id = UUID()
    let label: String
    var done = false
}

struct DiscoveredProject: Identifiable, Hashable {
    let id: String      // path
    let name: String
    let path: String
}

final class Runner: ObservableObject {
    static let scriptPath = ProcessInfo.processInfo.environment["C2S_SCRIPT"]
        ?? FileManager.default.currentDirectoryPath + "/chrome-to-safari.sh"

    @Published var steps: [Step] = []
    @Published var log = ""
    @Published var running = false
    @Published var finished = false
    @Published var succeeded = false

    private var process: Process?

    func run(input: String, env: [String: String] = [:], mode: ConversionMode = .convert) {
        steps = []
        log = ""
        finished = false
        succeeded = false
        running = true

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/bin/bash")
        switch mode {
        case .convert:
            proc.arguments = [Self.scriptPath, input]
        case .buildOnly:
            proc.arguments = [Self.scriptPath, input, "--build-only"]
        case .installOnly:
            proc.arguments = [Self.scriptPath, "--install-only"]
        }
        var environment = ProcessInfo.processInfo.environment
        for (key, value) in env where !value.trimmingCharacters(in: .whitespaces).isEmpty {
            environment[key] = value
        }
        proc.environment = environment
        let pipe = Pipe()
        proc.standardOutput = pipe
        proc.standardError = pipe

        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            DispatchQueue.main.async { self?.append(text) }
        }
        proc.terminationHandler = { [weak self] p in
            DispatchQueue.main.async {
                guard let self else { return }
                pipe.fileHandleForReading.readabilityHandler = nil
                for i in self.steps.indices { self.steps[i].done = true }
                self.running = false
                self.finished = true
                self.succeeded = p.terminationStatus == 0
            }
        }

        do {
            try proc.run()
            process = proc
        } catch {
            append("ERROR: could not run \(Self.scriptPath): \(error.localizedDescription)\n")
            running = false
            finished = true
        }
    }

    private func append(_ text: String) {
        log += text
        for line in text.split(separator: "\n") where line.hasPrefix("==> ") {
            for i in steps.indices { steps[i].done = true }
            steps.append(Step(label: String(line.dropFirst(4))))
        }
    }
}

struct ContentView: View {
    @StateObject private var runner = Runner()
    @State private var input = ""
    @State private var dropTargeted = false
    @State private var showLog = false
    @State private var showOptions = false
    @State private var appName = ""
    @State private var bundleID = ""
    @State private var teamID = ""
    @State private var mode: ConversionMode = .convert
    @AppStorage("c2sScanRoot") private var scanRoot = ""
    @State private var discovered: [DiscoveredProject] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Picker("Mode", selection: $mode) {
                ForEach(ConversionMode.allCases) { m in
                    Text(m.rawValue).tag(m)
                }
            }
            .pickerStyle(.segmented)
            .disabled(runner.running)

            workspaceRow

            if mode != .installOnly {
                dropZone
            } else {
                discovery
            }

            VStack(spacing: 12) {
                HStack(spacing: 8) {
                    Image(systemName: mode == .installOnly ? "folder" : "link")
                        .foregroundStyle(.secondary)
                    TextField(mode == .installOnly
                              ? "Output folder created by Build Only"
                              : "Store link or folder path",
                              text: $input)
                        .textFieldStyle(.roundedBorder)
                        .disabled(runner.running)
                        .onSubmit(convert)
                }

                Button(action: convert) {
                    HStack(spacing: 8) {
                        if runner.running {
                            ProgressView()
                                .controlSize(.small)
                        }
                        Text(runner.running ? runningLabel : buttonLabel)
                            .fontWeight(.medium)
                    }
                    .frame(maxWidth: .infinity)
                }
                .controlSize(.large)
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
                .disabled(runner.running || input.trimmingCharacters(in: .whitespaces).isEmpty)
            }

            DisclosureGroup("Options", isExpanded: $showOptions) {
                Text("Leave any field blank to use its default.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.top, 10)

                Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 8, verticalSpacing: 8) {
                    optionRow("App Name", "from the extension's manifest", $appName)
                    optionRow("Bundle ID", "com.converted.<name>", $bundleID)
                    optionRow("Team ID", "auto-detected from your keychain", $teamID)
                }
                .font(.callout)
                .disabled(runner.running)
            }
            .font(.callout)

            if !runner.steps.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(runner.steps) { step in
                        HStack(spacing: 8) {
                            if step.done {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(.green)
                            } else if runner.finished && !runner.succeeded {
                                Image(systemName: "xmark.circle.fill")
                                    .foregroundStyle(.red)
                            } else {
                                ProgressView()
                                    .controlSize(.small)
                            }
                            Text(step.label)
                                .font(.callout)
                                .foregroundStyle(step.done ? .secondary : .primary)
                        }
                        .transition(.opacity)
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.quinary, in: RoundedRectangle(cornerRadius: 8))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .strokeBorder(Color(nsColor: .separatorColor))
                )
            }

            if runner.finished {
                resultBanner
            }

            DisclosureGroup("Log", isExpanded: $showLog) {
                ScrollViewReader { proxy in
                    ScrollView {
                        Text(runner.log.isEmpty ? "No output yet." : runner.log)
                            .font(.caption.monospaced())
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .textSelection(.enabled)
                            .padding(8)
                        Color.clear.frame(height: 1).id("end")
                    }
                    .frame(height: 170)
                    .background(.quinary, in: RoundedRectangle(cornerRadius: 8))
                    .onChange(of: runner.log) { _ in proxy.scrollTo("end") }
                    .padding(.top, 8)
                }
            }
            .font(.callout)
        }
        .padding(20)
        .frame(width: 480)
        .animation(.easeOut(duration: 0.2), value: runner.steps.count)
        .animation(.easeOut(duration: 0.2), value: runner.finished)
        .onDrop(of: [.fileURL], isTargeted: $dropTargeted) { providers in
            guard let provider = providers.first else { return false }
            _ = provider.loadObject(ofClass: URL.self) { url, _ in
                if let url { DispatchQueue.main.async { input = url.path } }
            }
            return true
        }
        .onAppear {
            NSApp.setActivationPolicy(.regular)
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    private var dropZone: some View {
        VStack(spacing: 8) {
            Image(systemName: "puzzlepiece.extension")
                .font(.system(size: 30, weight: .light))
                .foregroundStyle(dropTargeted ? Color.accentColor : Color.secondary)
            Text("Drop an unpacked extension folder here, or click to choose one")
                .font(.callout.weight(.medium))
            Text("or paste a Chrome Web Store link below")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 26)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(dropTargeted ? Color.accentColor.opacity(0.08) : Color.clear)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(dropTargeted ? Color.accentColor : Color(nsColor: .separatorColor),
                              style: StrokeStyle(lineWidth: dropTargeted ? 2 : 1, dash: [5, 4]))
        )
        .contentShape(Rectangle())
        .onTapGesture { if !runner.running { chooseFolder() } }
        .animation(.easeOut(duration: 0.15), value: dropTargeted)
    }

    private var workspaceRow: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text("Converted Projects Folder")
                    .foregroundStyle(.secondary)
                Spacer()
                if mode == .installOnly {
                    Button("Scan") { refreshDiscoveries() }
                }
                Button("…") { chooseScanRoot() }
            }
            .font(.callout)

            HStack(spacing: 6) {
                TextField("where your converted projects live", text: $scanRoot)
                    .textFieldStyle(.roundedBorder)
                    .disabled(runner.running)
            }
            .font(.callout)

            if mode != .installOnly {
                Text("Build Only writes each extension into <this folder>/project/.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var discovery: some View {
        Group {
            if discovered.isEmpty {
                Text("No converted projects found here. Set the folder above, or type an output folder path below.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ScrollView {
                    VStack(spacing: 2) {
                        ForEach(discovered) { p in
                            Button {
                                input = p.path
                            } label: {
                                HStack {
                                    Image(systemName: "square.stack.3d.up.fill")
                                        .foregroundStyle(.secondary)
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(p.name)
                                            .font(.callout.weight(.medium))
                                        Text(p.path)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                            .lineLimit(1)
                                            .truncationMode(.middle)
                                    }
                                    Spacer()
                                    if input == p.path {
                                        Image(systemName: "checkmark")
                                            .foregroundStyle(Color.accentColor)
                                    }
                                }
                                .padding(6)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .background(input == p.path ? Color.accentColor.opacity(0.12) : .clear,
                                        in: RoundedRectangle(cornerRadius: 6))
                        }
                    }
                }
                .frame(maxHeight: 150)
            }
        }
        .onAppear { refreshDiscoveries() }
        .onChange(of: scanRoot) { refreshDiscoveries() }
    }

    private var resultBanner: some View {
        let ok = runner.succeeded
        return HStack(spacing: 10) {
            Image(systemName: ok ? "checkmark.seal.fill" : "exclamationmark.triangle.fill")
                .foregroundStyle(ok ? Color.green : Color.red)
            Text(ok ? successMessage : "Failed. See the log below for details.")
                .font(.callout.weight(.medium))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background((ok ? Color.green : Color.red).opacity(0.08),
                    in: RoundedRectangle(cornerRadius: 8))
        .onAppear { if !ok { showLog = true } }
    }

    private var successMessage: String {
        switch mode {
        case .convert:
            return "Done. Enable it in Safari → Settings → Extensions."
        case .buildOnly:
            return "Done. The built app is in the output folder — see the log for the path."
        case .installOnly:
            return "Done. Enable it in Safari → Settings → Extensions."
        }
    }

    private var buttonLabel: String {
        switch mode {
        case .convert:       return "Convert"
        case .buildOnly:     return "Build"
        case .installOnly:   return "Rebuild & Install"
        }
    }

    private var runningLabel: String {
        switch mode {
        case .convert:       return "Converting…"
        case .buildOnly:     return "Building…"
        case .installOnly:   return "Rebuilding…"
        }
    }

    private func convert() {
        let value = input.trimmingCharacters(in: .whitespaces)
        guard !value.isEmpty, !runner.running else { return }
        var env = ["APP_NAME": appName, "BUNDLE_ID": bundleID, "TEAM_ID": teamID]
        switch mode {
        case .convert, .buildOnly:
            if !scanRoot.isEmpty {
                env["OUT_DIR"] = scanRoot
            }
        case .installOnly:
            env["OUT_DIR"] = value
        }
        runner.run(input: value, env: env, mode: mode)
    }

    private func optionRow(_ label: String, _ defaultHint: String, _ text: Binding<String>) -> some View {
        GridRow {
            Text(label)
                .gridColumnAlignment(.trailing)
                .foregroundStyle(.secondary)
            TextField(defaultHint, text: text)
                .textFieldStyle(.roundedBorder)
        }
    }

    private func chooseScanRoot() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.message = "Pick the folder that contains your converted projects"
        if panel.runModal() == .OK, let url = panel.url {
            scanRoot = url.path
        }
    }

    // Find every converted app under a folder. Primary layout is a shared
    // workspace: <dir>/project/<App>/<App>.xcodeproj. Falle back to a single-app
    // output folder (<dir>/<App>/<App>.xcodeproj) for legacy setups.
    private func appProjects(in dir: String) -> [URL] {
        let fm = FileManager.default
        let root = URL(fileURLWithPath: dir)
        let projectRoot = root.appendingPathComponent("project")
        if let apps = try? fm.contentsOfDirectory(atPath: projectRoot.path) {
            let found = apps.compactMap { app -> URL? in
                let proj = projectRoot.appendingPathComponent("\(app)/\(app).xcodeproj")
                return fm.fileExists(atPath: proj.path) ? proj : nil
            }
            if !found.isEmpty { return found }
        }
        if let apps = try? fm.contentsOfDirectory(atPath: dir) {
            let found = apps.filter { !$0.hasSuffix(".xcodeproj") }.compactMap { app -> URL? in
                let proj = root.appendingPathComponent("\(app)/\(app).xcodeproj")
                return fm.fileExists(atPath: proj.path) ? proj : nil
            }
            if !found.isEmpty { return found }
        }
        return []
    }

    private func refreshDiscoveries() {
        discovered = []
        guard !scanRoot.isEmpty else { return }
        let fm = FileManager.default
        let root = URL(fileURLWithPath: scanRoot)
        var roots = [root]
        if let entries = try? fm.contentsOfDirectory(
                at: root, includingPropertiesForKeys: nil,
                options: [.skipsHiddenFiles]) {
            roots.append(contentsOf: entries.filter { $0.hasDirectoryPath })
        }
        var seen = Set<String>()
        var items: [DiscoveredProject] = []
        for candidate in roots {
            for proj in appProjects(in: candidate.path) {
                let appDir = proj.deletingLastPathComponent().path
                guard seen.insert(appDir).inserted else { continue }
                let name = proj.deletingLastPathComponent().lastPathComponent
                items.append(DiscoveredProject(id: appDir, name: name, path: appDir))
            }
        }
        items.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        discovered = items
    }

    private func chooseFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.message = "Pick the unpacked extension folder (the one containing manifest.json)"
        if panel.runModal() == .OK, let url = panel.url {
            input = url.path
        }
    }
}

@main
struct ChromeToSafariApp: App {
    var body: some Scene {
        WindowGroup("Chrome to Safari") {
            ContentView()
        }
        .windowResizability(.contentSize)
    }
}
