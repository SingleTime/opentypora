// makeicon.swift — 生成应用图标（1024² 主图 + 各尺寸），供 iconutil 打包 .icns
import Cocoa

func drawIcon(size: CGFloat) -> NSBitmapImageRep {
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: Int(size), pixelsHigh: Int(size),
        bitsPerSample: 8, samplesPerPixel: 4,
        hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0, bitsPerPixel: 0
    )!
    rep.size = NSSize(width: size, height: size)

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let ctx = NSGraphicsContext.current!.cgContext

    // macOS 图标留白：内容占 ~82%
    let inset = size * 0.085
    let rect = CGRect(x: inset, y: inset, width: size - inset * 2, height: size - inset * 2)
    let radius = rect.width * 0.225

    let path = CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)
    ctx.saveGState()
    ctx.addPath(path)
    ctx.clip()
    let colors = [
        CGColor(red: 0.22, green: 0.245, blue: 0.28, alpha: 1),
        CGColor(red: 0.105, green: 0.118, blue: 0.14, alpha: 1)
    ] as CFArray
    if let grad = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1]) {
        ctx.drawLinearGradient(grad,
                               start: CGPoint(x: rect.midX, y: rect.maxY),
                               end: CGPoint(x: rect.midX, y: rect.minY),
                               options: [])
    }
    ctx.restoreGState()

    // 顶边高光
    ctx.saveGState()
    ctx.addPath(path)
    ctx.setStrokeColor(CGColor(red: 1, green: 1, blue: 1, alpha: 0.09))
    ctx.setLineWidth(size * 0.006)
    ctx.strokePath()
    ctx.restoreGState()

    // 字母 T
    let fontSize = rect.height * 0.60
    let font = NSFont(name: "HelveticaNeue-Bold", size: fontSize) ?? NSFont.boldSystemFont(ofSize: fontSize)
    let attrs: [NSAttributedString.Key: Any] = [
        .font: font,
        .foregroundColor: NSColor(calibratedWhite: 0.97, alpha: 1)
    ]
    let str = NSAttributedString(string: "T", attributes: attrs)
    let bound = str.size()
    str.draw(at: NSPoint(x: rect.midX - bound.width / 2,
                         y: rect.midY - bound.height / 2 - rect.height * 0.035))

    // 底部强调条（Markdown 的下划线感）
    let barW = rect.width * 0.30
    let barH = rect.height * 0.036
    let bar = CGRect(x: rect.midX - barW / 2, y: rect.minY + rect.height * 0.145, width: barW, height: barH)
    let barPath = CGPath(roundedRect: bar, cornerWidth: barH / 2, cornerHeight: barH / 2, transform: nil)
    ctx.saveGState()
    ctx.addPath(barPath)
    ctx.setFillColor(CGColor(red: 0.36, green: 0.65, blue: 0.98, alpha: 1))
    ctx.fillPath()
    ctx.restoreGState()

    NSGraphicsContext.restoreGraphicsState()
    return rep
}

let outDir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "./iconset"
try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)

let specs: [(String, CGFloat)] = [
    ("icon_16x16.png", 16), ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32), ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128), ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256), ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512), ("icon_512x512@2x.png", 1024)
]

for (name, px) in specs {
    let rep = drawIcon(size: px)
    guard let data = rep.representation(using: .png, properties: [:]) else { continue }
    try? data.write(to: URL(fileURLWithPath: outDir).appendingPathComponent(name))
}

// 同时输出一张 1024 预览图
let big = drawIcon(size: 1024)
if let d = big.representation(using: .png, properties: [:]) {
    try? d.write(to: URL(fileURLWithPath: outDir).appendingPathComponent("preview-1024.png"))
}
print("icons written to \(outDir)")
