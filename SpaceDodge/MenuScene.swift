import SpriteKit

class MenuScene: SKScene {

    private var starField: SKEmitterNode?

    override func didMove(to view: SKView) {
        backgroundColor = SKColor(red: 0.05, green: 0.02, blue: 0.15, alpha: 1.0)

        createStarfield()
        createTitle()
        createPlayButton()
        createHighScoreLabel()
    }

    private func createStarfield() {
        if let emitter = createStarEmitter() {
            emitter.position = CGPoint(x: size.width / 2, y: size.height)
            emitter.advanceSimulationTime(10)
            addChild(emitter)
        }
    }

    private func createStarEmitter() -> SKEmitterNode? {
        let emitter = SKEmitterNode()
        emitter.particleBirthRate = 8
        emitter.particleLifetime = 14
        emitter.particlePositionRange = CGVector(dx: size.width, dy: 0)
        emitter.emissionAngle = .pi * 1.5
        emitter.emissionAngleRange = 0.1
        emitter.particleSpeed = 40
        emitter.particleSpeedRange = 20
        emitter.particleAlpha = 0.8
        emitter.particleAlphaRange = 0.2
        emitter.particleScale = 0.05
        emitter.particleScaleRange = 0.03
        emitter.particleColor = .white
        emitter.particleColorBlendFactor = 1.0
        emitter.particleBlendMode = .add
        return emitter
    }

    private func createTitle() {
        let title = SKLabelNode(fontNamed: "AvenirNext-Bold")
        title.text = "SPACE DODGE"
        title.fontSize = 44
        title.fontColor = SKColor(red: 0.3, green: 0.8, blue: 1.0, alpha: 1.0)
        title.position = CGPoint(x: size.width / 2, y: size.height * 0.7)
        addChild(title)

        let subtitle = SKLabelNode(fontNamed: "AvenirNext-Medium")
        subtitle.text = "Survive the asteroid field"
        subtitle.fontSize = 18
        subtitle.fontColor = SKColor(red: 0.6, green: 0.6, blue: 0.8, alpha: 1.0)
        subtitle.position = CGPoint(x: size.width / 2, y: size.height * 0.7 - 35)
        addChild(subtitle)

        // Ship preview
        let ship = SKLabelNode(text: "\u{1F680}")
        ship.fontSize = 60
        ship.position = CGPoint(x: size.width / 2, y: size.height * 0.5)
        addChild(ship)

        let bobUp = SKAction.moveBy(x: 0, y: 10, duration: 1.0)
        bobUp.timingMode = .easeInEaseOut
        let bobDown = bobUp.reversed()
        ship.run(.repeatForever(.sequence([bobUp, bobDown])))
    }

    private func createPlayButton() {
        let button = SKShapeNode(rectOf: CGSize(width: 200, height: 55), cornerRadius: 27)
        button.fillColor = SKColor(red: 0.2, green: 0.6, blue: 1.0, alpha: 1.0)
        button.strokeColor = SKColor(red: 0.4, green: 0.8, blue: 1.0, alpha: 1.0)
        button.lineWidth = 2
        button.position = CGPoint(x: size.width / 2, y: size.height * 0.3)
        button.name = "playButton"
        addChild(button)

        let label = SKLabelNode(fontNamed: "AvenirNext-Bold")
        label.text = "PLAY"
        label.fontSize = 24
        label.fontColor = .white
        label.verticalAlignmentMode = .center
        label.name = "playButton"
        button.addChild(label)

        let pulse = SKAction.sequence([
            SKAction.scale(to: 1.05, duration: 0.8),
            SKAction.scale(to: 1.0, duration: 0.8)
        ])
        button.run(.repeatForever(pulse))
    }

    private func createHighScoreLabel() {
        let highScore = UserDefaults.standard.integer(forKey: "highScore")
        let label = SKLabelNode(fontNamed: "AvenirNext-Medium")
        label.text = "Best: \(highScore)"
        label.fontSize = 20
        label.fontColor = SKColor(red: 1.0, green: 0.85, blue: 0.3, alpha: 1.0)
        label.position = CGPoint(x: size.width / 2, y: size.height * 0.2)
        addChild(label)
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let touch = touches.first else { return }
        let location = touch.location(in: self)
        let nodes = self.nodes(at: location)

        if nodes.contains(where: { $0.name == "playButton" }) {
            let transition = SKTransition.fade(withDuration: 0.5)
            let gameScene = GameScene(size: size)
            gameScene.scaleMode = .aspectFill
            view?.presentScene(gameScene, transition: transition)
        }
    }
}
