package main

import (
	"fmt"
	"os"

	"github.com/kardianos/service"
)

var svcConfig = &service.Config{
	Name:        "TallyGoAgent1",
	DisplayName: "TallyGoAgent1",
	Description: "Syncs invoices to Tally from Go",
}

type program struct{}

func (p *program) Start(s service.Service) error {
	go startAgent() // Call the function from agent.go
	return nil
}

func (p *program) Stop(s service.Service) error {
	return nil
}

func main() {
	s, err := service.New(&program{}, svcConfig)
	if err != nil {
		fmt.Println("Cannot create service:", err)
		return
	}

	if len(os.Args) > 1 {
		cmd := os.Args[1]
		switch cmd {
		case "install":
			s.Install()
			fmt.Println("✅ Service installed.")
		case "uninstall":
			s.Uninstall()
			fmt.Println("❌ Service uninstalled.")
		default:
			fmt.Println("Unknown command:", cmd)
		}
		return
	}

	err = s.Run()
	if err != nil {
		fmt.Println("Service run error:", err)
	}
}
