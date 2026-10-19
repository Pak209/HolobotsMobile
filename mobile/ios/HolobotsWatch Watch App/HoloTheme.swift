import CoreText
import SwiftUI

/// HoloCity HUD tokens for the Watch, mirrored from the phone's
/// `mobile/src/lite/theme.ts`. Colours live in Assets.xcassets (Holo*).
/// Presentation only; never progression state.
enum Holo {
    static let carbon = Color("HoloCarbon")   // colors.carbon  #101318
    static let navy = Color("HoloNavy")       // plates.navy    #081723
    static let raised = Color("HoloRaised")   // plates.raised  #102532
    static let accent = Color("HoloAccent")   // colors.accent  #62DDE8
    static let text = Color("HoloText")       // colors.text    #F4F7FA
    static let muted = Color("HoloMuted")     // colors.muted   #A9BDC8
    static let border = Color("HoloBorder")   // colors.border  #304956
    static let danger = Color("HoloDanger")   // colors.danger  #FF603D

    /// HoloDisplay on the phone (Rajdhani Medium, SIL OFL 1.1).
    static func display(_ size: CGFloat) -> Font {
        .custom("Rajdhani-Medium", fixedSize: size)
    }

    /// HoloBody on the phone (Saira Regular, SIL OFL 1.1). The bundled file is
    /// weight 400, but its name table carries the PostScript name "Saira-Thin".
    static func body(_ size: CGFloat) -> Font {
        .custom("Saira-Thin", fixedSize: size)
    }

    /// The Watch Info.plist has no UIAppFonts entry, so the bundled fonts are
    /// registered for this process at launch.
    static func registerFonts() {
        for name in ["Rajdhani-Medium", "Saira-Regular"] {
            guard let url = Bundle.main.url(forResource: name, withExtension: "ttf") else { continue }
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }
}
